import { spawn } from "node:child_process";
import { renameSync, rmSync, statSync } from "node:fs";

/**
 * Thin ffmpeg wrapper. Everything goes through an injectable `Runner` so the
 * test suite can exercise success, auth-failure and timeout paths without a
 * camera or a binary.
 *
 * Credentials are passed to ffmpeg as part of the stream URL (the only way the
 * RTSP demuxer accepts them) and never appear in logs: stderr is truncated and
 * only surfaced after the URL has been stripped by the caller.
 */

export type FailureKind = "auth" | "timeout" | "network" | "missing_binary" | "other";

export interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
}

export type Runner = (args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>;

export function ffmpegBin(): string {
  return process.env.HAMSA_FFMPEG_PATH || "ffmpeg";
}

export const defaultRunner: Runner = (args, { timeoutMs = 20_000 } = {}) =>
  new Promise((resolve) => {
    const child = spawn(/*turbopackIgnore: true*/ ffmpegBin(), ["-nostdin", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (code: number | null, extra?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(chunks),
        stderr: extra ? `${stderr}\n${extra}` : stderr,
        timedOut,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      // Raw frames are bounded by the caller; this only stops a runaway pipe
      // from eating the whole heap if a stream never ends.
      if (chunks.reduce((total, part) => total + part.length, 0) > 64 * 1024 * 1024) {
        child.kill("SIGKILL");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 32_000) stderr += chunk.toString();
    });

    child.on("error", (err) => finish(null, err.message));
    child.on("close", (code) => finish(code));
  });

/* ────────────────────────────── input policy ─────────────────────────────── */

/**
 * Only enrolled streams. Local files and `lavfi` sources are for the lab demo
 * described in the README; they are refused in production unless the operator
 * explicitly opts in.
 */
export function assertMediaInput(input: string): void {
  const value = input.trim();
  if (!value) throw new Error("Stream URL is empty");

  if (/^(rtsp|rtsps|http|https):\/\//i.test(value)) return;

  if (/^file:\/\//i.test(value) || value.startsWith("/")) {
    const allowed =
      process.env.HAMSA_CCTV_ALLOW_LOCAL_MEDIA === "true" || process.env.NODE_ENV !== "production";
    if (!allowed) {
      throw new Error(
        "Local media is disabled in production. Set HAMSA_CCTV_ALLOW_LOCAL_MEDIA=true for a lab camera.",
      );
    }
    return;
  }

  throw new Error("Only rtsp://, rtsps://, http:// and https:// streams are supported");
}

function inputArgs(input: string): string[] {
  if (/^rtsps?:\/\//i.test(input)) {
    return ["-rtsp_transport", "tcp", "-timeout", "8000000", "-i", input];
  }
  return ["-i", input];
}

/* ─────────────────────────────── failure kinds ───────────────────────────── */

const AUTH_PATTERNS = [
  /401\s+unauthori[sz]ed/i,
  /403\s+forbidden/i,
  /method\s+SETUP\s+failed:\s*40[13]/i,
  /unauthori[sz]ed/i,
  /authentication\s+failed/i,
  /invalid\s+credentials/i,
  /access\s+denied/i,
  /authorization\s+required/i,
];

const NETWORK_PATTERNS = [
  /connection\s+refused/i,
  /no\s+route\s+to\s+host/i,
  /name\s+or\s+service\s+not\s+known/i,
  /failed\s+to\s+resolve/i,
  /network\s+is\s+unreachable/i,
  /connection\s+timed\s+out/i,
];

export function classifyFailure(result: RunResult): FailureKind {
  if (result.timedOut) return "timeout";
  const text = result.stderr;
  if (result.code === null && /ENOENT|not found|no such file/i.test(text)) return "missing_binary";
  if (AUTH_PATTERNS.some((pattern) => pattern.test(text))) return "auth";
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(text))) return "network";
  if (/timed\s+out|timeout/i.test(text)) return "timeout";
  return "other";
}

/** Redacts `user:pass@` before an error message is persisted or shown. */
export function redactUrl(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, "$1***@");
}

const tail = (text: string, size = 600): string => redactUrl(text.slice(-size).trim());

/* ─────────────────────────────── operations ──────────────────────────────── */

export interface OperationResult {
  ok: boolean;
  kind?: FailureKind;
  detail?: string;
  bytes?: number;
}

export async function ffmpegAvailable(runner: Runner = defaultRunner): Promise<boolean> {
  const result = await runner(["-version"], { timeoutMs: 4_000 });
  return result.code === 0;
}

export async function probeStream(
  input: string,
  runner: Runner = defaultRunner,
  timeoutMs = 12_000,
): Promise<OperationResult> {
  assertMediaInput(input);
  const result = await runner(
    ["-hide_banner", "-loglevel", "error", ...inputArgs(input), "-t", "2", "-f", "null", "-"],
    { timeoutMs },
  );
  if (result.code === 0) return { ok: true };
  return { ok: false, kind: classifyFailure(result), detail: tail(result.stderr) };
}

export async function captureSnapshot(
  input: string,
  outPath: string,
  runner: Runner = defaultRunner,
  timeoutMs = 25_000,
): Promise<OperationResult> {
  assertMediaInput(input);
  const temp = `${outPath}.part.jpg`;
  const result = await runner(
    ["-hide_banner", "-loglevel", "error", "-y", ...inputArgs(input), "-frames:v", "1", "-q:v", "3", temp],
    { timeoutMs },
  );

  if (result.code === 0) {
    try {
      const bytes = statSync(temp).size;
      renameSync(temp, outPath);
      return { ok: true, bytes };
    } catch (err) {
      rmSync(temp, { force: true });
      return { ok: false, kind: "other", detail: (err as Error).message };
    }
  }

  rmSync(temp, { force: true });
  return { ok: false, kind: classifyFailure(result), detail: tail(result.stderr) };
}

export interface FrameOptions {
  width?: number;
  height?: number;
  fps?: number;
  count?: number;
}

/**
 * Grabs a short grayscale sequence for the motion baseline. 320×240 keeps the
 * per-frame work small enough to run inside a cron request.
 */
export async function captureGrayFrames(
  input: string,
  options: FrameOptions = {},
  runner: Runner = defaultRunner,
  timeoutMs = 25_000,
): Promise<{ ok: boolean; frames: Uint8Array[]; width: number; height: number; kind?: FailureKind; detail?: string }> {
  assertMediaInput(input);
  const width = options.width ?? 320;
  const height = options.height ?? 240;
  const fps = options.fps ?? 5;
  const count = options.count ?? 12;

  const result = await runner(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      ...inputArgs(input),
      "-t",
      String(count / fps),
      "-vf",
      `fps=${fps},scale=${width}:${height}`,
      "-pix_fmt",
      "gray",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { timeoutMs },
  );

  if (result.code !== 0) {
    return { ok: false, frames: [], width, height, kind: classifyFailure(result), detail: tail(result.stderr) };
  }

  const frameSize = width * height;
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset + frameSize <= result.stdout.length; offset += frameSize) {
    frames.push(new Uint8Array(result.stdout.subarray(offset, offset + frameSize)));
  }
  return { ok: true, frames, width, height };
}
