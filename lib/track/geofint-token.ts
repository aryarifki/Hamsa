import { createHmac } from "node:crypto";
import { safeEqual } from "../crypto";

/**
 * Short-lived capability token for the public chain page.
 *
 * Phone-X issues a token before letting the browser talk to a chain. The same
 * shape is kept here so the client flow ports 1:1: `POST /api/v1/geofint/token`
 * with a chain code returns a signed token; report submissions may present it
 * in `x-geofint-token`. The chain code alone also works, because the code is
 * already the capability — the token only proves the holder visited the page
 * after it was issued.
 */

const TTL_MS = 15 * 60_000;

function key(): string {
  return process.env.HAMSA_SECRET?.trim() || "hamsa-dev-insecure-fallback";
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export interface GeofintToken {
  token: string;
  expiresAt: string;
  code: string;
}

export function issueToken(code: string, nowMs = Date.now()): GeofintToken {
  const normalized = code.trim().toUpperCase();
  const expires = nowMs + TTL_MS;
  const payload = `${normalized}.${expires}`;
  return {
    token: `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`,
    expiresAt: new Date(expires).toISOString(),
    code: normalized,
  };
}

export function verifyToken(token: string, code?: string, nowMs = Date.now()): boolean {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return false;
  }

  if (!safeEqual(sign(payload), signature)) return false;

  const [payloadCode, expiresRaw] = payload.split(".");
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires <= nowMs) return false;
  if (code && payloadCode !== code.trim().toUpperCase()) return false;
  return true;
}
