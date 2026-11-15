import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Hidden-upstream relay state for the Polaris CCTV player.
 *
 * Playlist URLs are rewritten so segment fetches round-trip through Hamsa
 * with an HMAC-signed token; the upstream URL itself never reaches the
 * browser. Tokens expire: segment TTLs upstream are short.
 */

interface RelayState {
  base: string;
  expires: number;
}

const states = new Map<string, RelayState>();
const TTL = 10 * 60_000;
const SECRET = process.env.HAMSA_RELAY_SECRET || randomBytes(32).toString("hex");

function sign(raw: string): string {
  return createHmac("sha256", SECRET).update(raw).digest("hex");
}

export function issueSegmentToken(base: string): string {
  const raw = randomBytes(12).toString("hex");
  states.set(raw, { base, expires: Date.now() + TTL });
  if (states.size > 400) {
    for (const [k, v] of states) if (v.expires < Date.now()) states.delete(k);
  }
  return `${raw}.${sign(raw)}`;
}

export function resolveSegment(token: string, relative: string): string | null {
  const [raw, sig] = token.split(".");
  if (!raw || !sig) return null;
  const expect = sign(raw);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expect, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const state = states.get(raw);
  if (!state || state.expires < Date.now()) return null;
  try {
    return new URL(relative, state.base).href;
  } catch {
    return null;
  }
}

/**
 * Rewrite a proxied HLS playlist: every non-tag line becomes a segment-proxy
 * URL. Handles both media playlists (segments) and master playlists
 * (variant URIs — the segment route rewrites those recursively).
 */
export function rewritePlaylist(playlist: string, token: string, proxyBase: string): string {
  return playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return `${proxyBase}/segment?t=${encodeURIComponent(token)}&s=${encodeURIComponent(trimmed)}`;
    })
    .join("\n");
}

export async function fetchUpstream(url: string): Promise<{ ok: boolean; status: number; text?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Hamsa-Polaris/1.0 (+https://hamsa.avenia.my.id)" },
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    return { ok: true, status: 200, text };
  } catch {
    return { ok: false, status: 502 };
  }
}
