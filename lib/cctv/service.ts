import { all, newId, now, one, run, tx } from "../db";
import { audit } from "../audit";
import { decryptSecret, encryptSecret } from "../crypto";
import { notifyAdmins } from "../notify";
import type { User } from "../users";
import {
  captureGrayFrames,
  captureSnapshot,
  defaultRunner,
  probeStream,
  redactUrl,
  type FailureKind,
  type Runner,
} from "./ffmpeg";
import { Mog2 } from "./mog2";
import {
  createPullSubscription,
  discoverEventsUrl,
  fetchTransport,
  normaliseOnvifHost,
  onvifDeviceUrl,
  pullMessages,
  OnvifError,
  type SoapTransport,
} from "./onvif";
import { newSnapshotPath, removeCameraDir, removeFile } from "./storage";

/**
 * Own-asset camera service.
 *
 * Nothing here discovers or scans cameras: a row only exists because an
 * operator enrolled a stream they control. The fail-closed rule is enforced in
 * one place (`failClosed`): an authentication failure disables the camera,
 * notifies every administrator and audits the transition, and the scheduler
 * skips disabled cameras so a wrong password cannot lock an account out.
 */

export interface Camera {
  id: string;
  name: string;
  rtsp_url: string;
  onvif_host: string | null;
  username_enc: string | null;
  password_enc: string | null;
  status: string;
  created_by: string | null;
  snapshot_interval_s: number;
  motion_threshold: number | null;
  last_snapshot_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  disabled_reason: string | null;
  onvif_events_url: string | null;
  onvif_sub_url: string | null;
  onvif_sub_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CameraSnapshot {
  id: string;
  camera_id: string;
  file_path: string;
  bytes: number;
  motion_ratio: number | null;
  motion_detected: number;
  captured_at: string;
}

export interface CameraEvent {
  id: string;
  camera_id: string;
  type: string;
  source: string;
  ts: string;
  detail: string | null;
}

export interface CameraDeps {
  runner?: Runner;
  transport?: SoapTransport;
}

const DEFAULT_MOTION_THRESHOLD = 0.01;

function motionThresholdFor(camera: Camera): number {
  if (typeof camera.motion_threshold === "number") return camera.motion_threshold;
  const env = Number(process.env.HAMSA_MOTION_THRESHOLD);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_MOTION_THRESHOLD;
}

/* ─────────────────────────────── enrolment ───────────────────────────────── */

function splitCredentials(url: string): { url: string; username?: string; password?: string } {
  try {
    const parsed = new URL(url);
    if (!parsed.username) return { url };
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    parsed.username = "";
    parsed.password = "";
    return { url: parsed.toString(), username, password };
  } catch {
    return { url };
  }
}

function withCredentials(url: string, username?: string, password?: string): string {
  if (!username) return url;
  try {
    const parsed = new URL(url);
    if (!/^(rtsp|rtsps|https?):/.test(parsed.protocol)) return url;
    parsed.username = username;
    parsed.password = password ?? "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function readCredentials(camera: Camera): { username?: string; password?: string } {
  if (!camera.username_enc) return {};
  try {
    return {
      username: decryptSecret(camera.username_enc),
      password: camera.password_enc ? decryptSecret(camera.password_enc) : "",
    };
  } catch {
    throw new Error("Stored camera credentials cannot be decrypted; re-save them with the current HAMSA_SECRET");
  }
}

export interface CreateCameraInput {
  user: User;
  name: string;
  streamUrl: string;
  onvifHost?: string;
  username?: string;
  password?: string;
  intervalSeconds?: number;
  motionThreshold?: number | null;
}

export async function createCamera(input: CreateCameraInput): Promise<Camera> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Camera name is too short");

  let streamUrl = input.streamUrl.trim();
  if (!streamUrl) throw new Error("Stream URL is required");
  if (/\s/.test(streamUrl)) throw new Error("Stream URL must not contain whitespace");

  // A pasted `rtsp://user:pass@host/...` is split into the encrypted columns;
  // the URL column keeps only host/path so it is safe to render.
  let username = input.username?.trim() || undefined;
  let password = input.password || undefined;
  const split = splitCredentials(streamUrl);
  if (split.username) {
    username = split.username;
    password = split.password;
    streamUrl = split.url;
  }

  if (streamUrl.startsWith("/") && (process.env.HAMSA_CCTV_ALLOW_LOCAL_MEDIA === "true" || process.env.NODE_ENV !== "production")) {
    streamUrl = `file://${streamUrl}`;
  }

  const parsed = new URL(streamUrl);
  if (!["rtsp:", "rtsps:", "http:", "https:", "file:"].includes(parsed.protocol)) {
    throw new Error("Only rtsp, rtsps, http and https streams are supported");
  }
  if (parsed.protocol === "file:" && process.env.NODE_ENV === "production" && process.env.HAMSA_CCTV_ALLOW_LOCAL_MEDIA !== "true") {
    throw new Error("Local files are disabled in production. Set HAMSA_CCTV_ALLOW_LOCAL_MEDIA=true for a lab camera.");
  }

  const onvifHost = input.onvifHost?.trim() ? normaliseOnvifHost(input.onvifHost) : null;
  const interval = Math.min(86_400, Math.max(30, Math.round(input.intervalSeconds ?? 300)));
  const threshold =
    input.motionThreshold === null || input.motionThreshold === undefined
      ? null
      : Math.min(0.5, Math.max(0.0005, input.motionThreshold));

  const id = newId();
  const stamp = now();
  await run(
    `INSERT INTO cameras
       (id, name, rtsp_url, onvif_host, username_enc, password_enc, status, created_by,
        snapshot_interval_s, motion_threshold, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?, ?, ?)`,
    id,
    name,
    streamUrl,
    onvifHost,
    username ? encryptSecret(username) : null,
    password ? encryptSecret(password) : null,
    input.user.id,
    interval,
    threshold,
    stamp,
    stamp,
  );

  await audit({
    userId: input.user.id,
    actor: input.user.email,
    action: "camera.create",
    entity: "camera",
    entityId: id,
    meta: { name, onvif: Boolean(onvifHost) },
  });

  return (await one<Camera>("SELECT * FROM cameras WHERE id = ?", id))!;
}

/* ──────────────────────────────── queries ────────────────────────────────── */

export async function listCameras(user: User): Promise<Camera[]> {
  if (user.role === "admin") {
    return all<Camera>("SELECT * FROM cameras ORDER BY created_at DESC");
  }
  return all<Camera>("SELECT * FROM cameras WHERE created_by = ? ORDER BY created_at DESC", user.id);
}

export async function cameraForUser(id: string, user: User): Promise<Camera | undefined> {
  const camera = await one<Camera>("SELECT * FROM cameras WHERE id = ?", id);
  if (!camera) return undefined;
  if (user.role !== "admin" && camera.created_by !== user.id) return undefined;
  return camera;
}

export async function latestSnapshot(cameraId: string): Promise<CameraSnapshot | undefined> {
  return one<CameraSnapshot>(
    "SELECT * FROM camera_snapshots WHERE camera_id = ? ORDER BY captured_at DESC LIMIT 1",
    cameraId,
  );
}

export async function listSnapshots(cameraId: string, limit = 12): Promise<CameraSnapshot[]> {
  return all<CameraSnapshot>(
    "SELECT * FROM camera_snapshots WHERE camera_id = ? ORDER BY captured_at DESC LIMIT ?",
    cameraId,
    limit,
  );
}

export async function listCameraEvents(cameraId: string, limit = 20): Promise<CameraEvent[]> {
  return all<CameraEvent>(
    "SELECT * FROM camera_events WHERE camera_id = ? ORDER BY ts DESC LIMIT ?",
    cameraId,
    limit,
  );
}

export async function recentCameraEvents(user: User, limit = 20): Promise<Array<CameraEvent & { camera_name: string }>> {
  const scope = user.role === "admin" ? "" : "WHERE c.created_by = ?";
  return all<CameraEvent & { camera_name: string }>(
    `SELECT e.*, c.name AS camera_name
     FROM camera_events e JOIN cameras c ON c.id = e.camera_id
     ${scope}
     ORDER BY e.ts DESC LIMIT ?`,
    ...(user.role === "admin" ? [] : [user.id]),
    limit,
  );
}

/* ───────────────────────────── fail-closed path ──────────────────────────── */

async function setStatus(camera: Camera, status: string, error: string | null): Promise<void> {
  await run(
    "UPDATE cameras SET status = ?, last_error = ?, updated_at = ? WHERE id = ?",
    status,
    error,
    now(),
    camera.id,
  );
}

async function failClosed(camera: Camera, detail: string): Promise<void> {
  const message = redactUrl(detail).slice(0, 500);
  await run(
    `UPDATE cameras
     SET status = 'disabled_auth', disabled_reason = ?, last_error = ?,
         consecutive_failures = consecutive_failures + 1, updated_at = ?
     WHERE id = ?`,
    "Authentication failed — camera disabled until an operator fixes the credentials",
    message,
    now(),
    camera.id,
  );

  if (camera.status !== "disabled_auth") {
    await notifyAdmins({
      kind: "camera.disabled",
      title: `Camera disabled: ${camera.name}`,
      body: `Authentication failed for ${camera.rtsp_url || camera.id}. The camera was disabled automatically; fix the credentials and re-enable it.`,
      entity: "camera",
      entityId: camera.id,
    });
    await audit({
      userId: null,
      actor: "system",
      action: "camera.disabled",
      entity: "camera",
      entityId: camera.id,
      meta: { reason: message },
    });
  }
}

/* ───────────────────────────────── checks ────────────────────────────────── */

export interface CameraCheckResult {
  ok: boolean;
  status: string;
  kind?: FailureKind | "config";
  detail?: string;
}

export async function checkCamera(
  id: string,
  user?: User,
  deps: CameraDeps = {},
): Promise<CameraCheckResult> {
  const camera = user ? await cameraForUser(id, user) : await one<Camera>("SELECT * FROM cameras WHERE id = ?", id);
  if (!camera) throw new Error("Camera not found");
  if (!camera.rtsp_url) {
    await setStatus(camera, "needs_config", "No stream URL");
    return { ok: false, status: "needs_config", kind: "config", detail: "No stream URL" };
  }

  let credentials: { username?: string; password?: string };
  try {
    credentials = readCredentials(camera);
  } catch (err) {
    await setStatus(camera, "needs_config", (err as Error).message);
    return { ok: false, status: "needs_config", kind: "config", detail: (err as Error).message };
  }

  const stream = withCredentials(camera.rtsp_url, credentials.username, credentials.password);
  const result = await probeStream(stream, deps.runner ?? defaultRunner);

  if (result.ok) {
    await run(
      "UPDATE cameras SET status = 'online', last_error = NULL, consecutive_failures = 0, updated_at = ? WHERE id = ?",
      now(),
      camera.id,
    );
    await audit({
      userId: user?.id ?? null,
      actor: user?.email ?? "system",
      action: "camera.check",
      entity: "camera",
      entityId: camera.id,
      meta: { online: true },
    });
    return { ok: true, status: "online" };
  }

  if (result.kind === "auth") {
    await failClosed(camera, result.detail ?? "Authentication failed");
    return { ok: false, status: "disabled_auth", kind: "auth", detail: result.detail };
  }

  await run(
    `UPDATE cameras
     SET status = 'offline', last_error = ?, consecutive_failures = consecutive_failures + 1, updated_at = ?
     WHERE id = ?`,
    result.detail ?? "unreachable",
    now(),
    camera.id,
  );
  await audit({
    userId: user?.id ?? null,
    actor: user?.email ?? "system",
    action: "camera.check",
    entity: "camera",
    entityId: camera.id,
    meta: { online: false, kind: result.kind ?? "other" },
  });
  return { ok: false, status: "offline", kind: result.kind, detail: result.detail };
}

/* ──────────────────────────────── snapshots ──────────────────────────────── */

export interface CaptureResult {
  ok: boolean;
  snapshotId?: string;
  capturedAt?: string;
  motionRatio?: number | null;
  motionDetected?: boolean;
  kind?: FailureKind | "config";
  detail?: string;
}

export async function captureCamera(
  id: string,
  user?: User,
  deps: CameraDeps = {},
): Promise<CaptureResult> {
  const camera = user ? await cameraForUser(id, user) : await one<Camera>("SELECT * FROM cameras WHERE id = ?", id);
  if (!camera) throw new Error("Camera not found");

  if (camera.status === "disabled_auth") {
    return {
      ok: false,
      kind: "auth",
      detail: "Camera is disabled after an authentication failure; re-enable it after fixing the credentials.",
    };
  }
  if (!camera.rtsp_url) {
    await setStatus(camera, "needs_config", "No stream URL");
    return { ok: false, kind: "config", detail: "No stream URL" };
  }

  let credentials: { username?: string; password?: string };
  try {
    credentials = readCredentials(camera);
  } catch (err) {
    await setStatus(camera, "needs_config", (err as Error).message);
    return { ok: false, kind: "config", detail: (err as Error).message };
  }

  const stream = withCredentials(camera.rtsp_url, credentials.username, credentials.password);
  const runner = deps.runner ?? defaultRunner;
  const capturedAt = now();
  const filePath = newSnapshotPath(camera.id, new Date(capturedAt));

  const shot = await captureSnapshot(stream, filePath, runner);

  if (!shot.ok) {
    if (shot.kind === "auth") {
      await failClosed(camera, shot.detail ?? "Authentication failed");
      return { ok: false, kind: "auth", detail: shot.detail };
    }
    await run(
      `UPDATE cameras
       SET status = 'offline', last_error = ?, consecutive_failures = consecutive_failures + 1, updated_at = ?
       WHERE id = ?`,
      shot.detail ?? "capture failed",
      now(),
      camera.id,
    );
    await audit({
      userId: user?.id ?? null,
      actor: user?.email ?? "system",
      action: "camera.snapshot",
      entity: "camera",
      entityId: camera.id,
      meta: { ok: false, kind: shot.kind ?? "other" },
    });
    return { ok: false, kind: shot.kind, detail: shot.detail };
  }

  // Motion baseline. A failed frame grab must not discard a good still.
  let ratio: number | null = null;
  let motion = false;
  try {
    const grabbed = await captureGrayFrames(stream, {}, runner);
    if (grabbed.ok && grabbed.frames.length >= 3) {
      const model = new Mog2(grabbed.width, grabbed.height, {
        warmup: Math.min(5, Math.max(2, grabbed.frames.length - 2)),
      });
      let last = 0;
      for (const frame of grabbed.frames) last = model.apply(frame).ratio;
      ratio = Number(last.toFixed(5));
      motion = ratio >= motionThresholdFor(camera);
    }
  } catch (err) {
    console.warn("[cctv] motion pass skipped:", (err as Error).message);
  }

  const snapshotId = newId();
  await run(
    `INSERT INTO camera_snapshots
       (id, camera_id, file_path, bytes, motion_ratio, motion_detected, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    snapshotId,
    camera.id,
    filePath,
    shot.bytes ?? 0,
    ratio,
    motion ? 1 : 0,
    capturedAt,
  );

  if (motion) {
    await run(
      "INSERT INTO camera_events (id, camera_id, type, source, ts, detail) VALUES (?, ?, 'motion', 'mog2', ?, ?)",
      newId(),
      camera.id,
      capturedAt,
      JSON.stringify({ ratio, threshold: motionThresholdFor(camera) }),
    );
  }

  await run(
    `UPDATE cameras
     SET status = 'online', last_error = NULL, consecutive_failures = 0,
         last_snapshot_at = ?, updated_at = ?
     WHERE id = ?`,
    capturedAt,
    now(),
    camera.id,
  );

  await audit({
    userId: user?.id ?? null,
    actor: user?.email ?? "system",
    action: "camera.snapshot",
    entity: "camera",
    entityId: camera.id,
    meta: { snapshotId, bytes: shot.bytes ?? 0, motion, ratio },
  });

  return { ok: true, snapshotId, capturedAt, motionRatio: ratio, motionDetected: motion };
}

/* ─────────────────────────────── ONVIF poll ──────────────────────────────── */

export interface OnvifPollResult {
  ok: boolean;
  events: number;
  motionEvents: number;
  detail?: string;
}

const SUBSCRIPTION_TTL_MS = 9 * 60 * 1000;

export async function pollCameraEvents(
  id: string,
  user?: User,
  deps: CameraDeps = {},
): Promise<OnvifPollResult> {
  const camera = user ? await cameraForUser(id, user) : await one<Camera>("SELECT * FROM cameras WHERE id = ?", id);
  if (!camera) throw new Error("Camera not found");
  if (!camera.onvif_host) throw new Error("This camera has no ONVIF host configured");
  if (camera.status === "disabled_auth") {
    return { ok: false, events: 0, motionEvents: 0, detail: "Camera disabled after an authentication failure" };
  }

  const transport = deps.transport ?? fetchTransport;
  let credentials: { username?: string; password?: string };
  try {
    credentials = readCredentials(camera);
  } catch (err) {
    return { ok: false, events: 0, motionEvents: 0, detail: (err as Error).message };
  }

  try {
    const deviceUrl = onvifDeviceUrl(camera.onvif_host);
    const eventsUrl =
      camera.onvif_events_url ?? (await discoverEventsUrl(deviceUrl, transport, credentials));

    if (!eventsUrl) {
      await setStatus(camera, camera.status, "ONVIF reported no Events service");
      return { ok: false, events: 0, motionEvents: 0, detail: "No ONVIF events service" };
    }

    const freshSubscription =
      camera.onvif_sub_url &&
      camera.onvif_sub_at &&
      Date.now() - new Date(camera.onvif_sub_at).getTime() < SUBSCRIPTION_TTL_MS;

    const subscriptionUrl = freshSubscription
      ? camera.onvif_sub_url!
      : await createPullSubscription(eventsUrl, transport, credentials);

    const notifications = await pullMessages(subscriptionUrl, transport, credentials, {
      timeoutSeconds: 2,
      max: 10,
    });

    let motionEvents = 0;
    for (const notification of notifications) {
      if (!notification.motion) continue;
      await run(
        "INSERT INTO camera_events (id, camera_id, type, source, ts, detail) VALUES (?, ?, 'motion', 'onvif', ?, ?)",
        newId(),
        camera.id,
        notification.utcTime ? new Date(notification.utcTime).toISOString() : now(),
        JSON.stringify({ topic: notification.topic, source: notification.source }),
      );
      motionEvents += 1;
    }

    await run(
      `UPDATE cameras
       SET onvif_events_url = ?, onvif_sub_url = ?, onvif_sub_at = ?, last_error = NULL, updated_at = ?
       WHERE id = ?`,
      eventsUrl,
      subscriptionUrl,
      now(),
      now(),
      camera.id,
    );

    if (motionEvents > 0) {
      await audit({
        userId: user?.id ?? null,
        actor: user?.email ?? "system",
        action: "camera.event",
        entity: "camera",
        entityId: camera.id,
        meta: { motionEvents, total: notifications.length },
      });
    }

    return { ok: true, events: notifications.length, motionEvents };
  } catch (err) {
    if (err instanceof OnvifError && (err.status === 401 || err.status === 403)) {
      await failClosed(camera, err.message);
      return { ok: false, events: 0, motionEvents: 0, detail: err.message };
    }
    await setStatus(camera, camera.status, (err as Error).message.slice(0, 500));
    return { ok: false, events: 0, motionEvents: 0, detail: (err as Error).message };
  }
}

/* ─────────────────────────────── scheduler ───────────────────────────────── */

export interface CameraRunSummary {
  checked: number;
  captured: number;
  motion: number;
  onvifEvents: number;
  errors: number;
  results: Array<{ id: string; name: string; captured: boolean; motion: boolean; error?: string }>;
}

/**
 * One bounded scheduler pass. Due means "never captured" or "interval elapsed".
 * Disabled/needs-config cameras are skipped; the operator must fix and re-enable
 * them, which is the point of fail-closed.
 */
export async function runDueCameras(limit = 5, deps: CameraDeps = {}): Promise<CameraRunSummary> {
  const due = await tx(async (db) => db.all<Camera>(
    `WITH due AS (
       SELECT id FROM cameras
       WHERE status NOT IN ('disabled_auth', 'needs_config')
         AND (status <> 'running' OR updated_at + (snapshot_interval_s * INTERVAL '1 second') <= now())
         AND (last_snapshot_at IS NULL
              OR last_snapshot_at + (snapshot_interval_s * INTERVAL '1 second') <= now())
       ORDER BY COALESCE(last_snapshot_at, TIMESTAMPTZ '1970-01-01') ASC
       FOR UPDATE SKIP LOCKED
       LIMIT ?
     )
     UPDATE cameras c
     SET status = 'running', updated_at = now()
     FROM due
     WHERE c.id = due.id
     RETURNING c.*`,
    limit,
  ));

  const summary: CameraRunSummary = {
    checked: 0,
    captured: 0,
    motion: 0,
    onvifEvents: 0,
    errors: 0,
    results: [],
  };

  for (const camera of due) {
    summary.checked += 1;
    try {
      const shot = await captureCamera(camera.id, undefined, deps);
      if (shot.ok) summary.captured += 1;
      if (shot.motionDetected) summary.motion += 1;

      if (camera.onvif_host) {
        const events = await pollCameraEvents(camera.id, undefined, deps);
        summary.onvifEvents += events.motionEvents;
      }

      summary.results.push({
        id: camera.id,
        name: camera.name,
        captured: shot.ok,
        motion: Boolean(shot.motionDetected),
        error: shot.ok ? undefined : shot.detail,
      });
    } catch (err) {
      summary.errors += 1;
      summary.results.push({
        id: camera.id,
        name: camera.name,
        captured: false,
        motion: false,
        error: (err as Error).message,
      });
    }
  }

  return summary;
}

/* ──────────────────────────────── lifecycle ──────────────────────────────── */

export async function enableCamera(id: string, user: User): Promise<void> {
  const camera = await cameraForUser(id, user);
  if (!camera) throw new Error("Camera not found");
  await run(
    `UPDATE cameras
     SET status = 'unknown', disabled_reason = NULL, last_error = NULL,
         consecutive_failures = 0, updated_at = ?
     WHERE id = ?`,
    now(),
    id,
  );
  await audit({
    userId: user.id,
    actor: user.email,
    action: "camera.update",
    entity: "camera",
    entityId: id,
    meta: { status: "enabled" },
  });
}

export async function deleteCamera(id: string, user: User): Promise<void> {
  const camera = await cameraForUser(id, user);
  if (!camera) throw new Error("Camera not found");

  await run("DELETE FROM cameras WHERE id = ?", id);
  removeCameraDir(id);

  await audit({
    userId: user.id,
    actor: user.email,
    action: "camera.delete",
    entity: "camera",
    entityId: id,
    meta: { name: camera.name },
  });
}

/** Removes snapshot metadata older than `days`, keeping disk usage bounded. */
export async function pruneSnapshots(days = 14): Promise<number> {
  const rows = await all<{ id: string; file_path: string }>(
    "SELECT id, file_path FROM camera_snapshots WHERE captured_at < now() - (? * INTERVAL '1 day')",
    days,
  );
  for (const row of rows) {
    await run("DELETE FROM camera_snapshots WHERE id = ?", row.id);
    removeFile(row.file_path);
  }
  return rows.length;
}
