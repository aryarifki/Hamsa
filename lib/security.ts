import { createHash } from "node:crypto";
import { randomToken, encryptSecret, decryptSecret } from "./crypto";
import { newId, now, one, all, run } from "./db";
import { rateLimit } from "./rate-limit";
import { HttpError } from "./http";

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function createApiKey(userId: string, name: string): { token: string; row: ApiKeyRow } {
  const secret = randomToken(24);
  const prefix = `hk_${randomToken(4)}`;
  const token = `${prefix}_${secret}`;
  const hash = createHash("sha256").update(token).digest("hex");
  const id = newId();
  run(
    `INSERT INTO api_keys (id, user_id, name, prefix, key_hash, scopes, created_at)
     VALUES (?, ?, ?, ?, ?, 'lookup', ?)`,
    id,
    userId,
    name.slice(0, 80),
    prefix,
    hash,
    now(),
  );
  return { token, row: apiKeyById(id)! };
}

export function apiKeyById(id: string): ApiKeyRow | undefined {
  return one<ApiKeyRow>(
    "SELECT id, user_id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE id = ?",
    id,
  );
}

export function listApiKeys(userId: string): ApiKeyRow[] {
  return all<ApiKeyRow>(
    `SELECT id, user_id, name, prefix, created_at, last_used_at, revoked_at
     FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
    userId,
  );
}

export function revokeApiKey(id: string, userId: string): boolean {
  return run("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL", now(), id, userId).changes > 0;
}

/* ------------------------------------------------------------------ */
/* Providers (admin-managed credentials, encrypted at rest)            */
/* ------------------------------------------------------------------ */

export interface ProviderRow {
  id: string;
  kind: string;
  name: string;
  enabled: number;
  config: string | null;
  updated_at: string;
}

export const PROVIDER_CATALOG = [
  { kind: "ip", name: "ipinfo.io", env: "IPINFO_TOKEN", docs: "https://ipinfo.io/signup" },
  { kind: "phone", name: "Numverify", env: "NUMVERIFY_KEY", docs: "https://numverify.com" },
  { kind: "email", name: "Have I Been Pwned", env: "HIBP_API_KEY", docs: "https://haveibeenpwned.com/API/Key" },
] as const;

export function listProviders(): ProviderRow[] {
  return all<ProviderRow>("SELECT * FROM providers ORDER BY kind, name");
}

export function upsertProvider(input: { kind: string; name: string; apiKey: string; enabled: boolean }): void {
  const existing = one<{ id: string }>("SELECT id FROM providers WHERE kind = ? AND name = ?", input.kind, input.name);
  const encrypted = input.apiKey ? encryptSecret(input.apiKey) : null;
  if (existing) {
    run(
      "UPDATE providers SET enabled = ?, config = COALESCE(?, config), updated_at = ? WHERE id = ?",
      input.enabled ? 1 : 0,
      encrypted,
      now(),
      existing.id,
    );
    return;
  }
  run(
    "INSERT INTO providers (id, kind, name, enabled, config, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    newId(),
    input.kind,
    input.name,
    input.enabled ? 1 : 0,
    encrypted,
    now(),
  );
}

/**
 * Reads a provider credential: an admin-set value in the DB wins, otherwise the
 * environment variable is used. Secrets never leave the server in plaintext.
 */
export function providerSecret(env: string): string | null {
  const entry = PROVIDER_CATALOG.find((p) => p.env === env);
  if (entry) {
    const row = one<{ config: string | null; enabled: number }>(
      "SELECT config, enabled FROM providers WHERE kind = ? AND name = ?",
      entry.kind,
      entry.name,
    );
    if (row?.enabled && row.config) {
      try {
        return decryptSecret(row.config);
      } catch {
        /* fall through to env */
      }
    }
  }
  return process.env[env] || null;
}

/* ------------------------------------------------------------------ */
/* Guardrails                                                          */
/* ------------------------------------------------------------------ */

export function enforceRate(req: Request, bucket: string, limit = 30, windowMs = 60_000): void {
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const res = rateLimit(`${bucket}:${ip}`, limit, windowMs);
  if (!res.allowed) {
    throw new HttpError(429, "Too many requests", { retryAfter: res.retryAfter });
  }
}
