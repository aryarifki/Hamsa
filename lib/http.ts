import { NextRequest, NextResponse } from "next/server";
import { one, run, now } from "./db";
import { currentUser, type User } from "./auth";
import { sha256 } from "./crypto";

export class HttpError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function fail(status: number, message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function userAgent(req: Request): string {
  return req.headers.get("user-agent") ?? "unknown";
}

export interface AuthContext {
  user: User;
  via: "session" | "api_key";
  apiKeyId?: string;
}

/**
 * Accepts either the browser session cookie or a bearer API key (`hk_...`).
 * API keys are hashed with SHA-256 at rest and compared by digest.
 */
export async function authenticate(req: Request | NextRequest): Promise<AuthContext | null> {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token.startsWith("hk_")) {
      const row = await one<{ id: string; user_id: string; revoked_at: string | null }>(
        "SELECT id, user_id, revoked_at FROM api_keys WHERE key_hash = ?",
        sha256(token),
      );
      if (!row || row.revoked_at) return null;
      const user = await one<User>(
        "SELECT id, email, name, role, status, credits, created_at, last_login_at FROM users WHERE id = ?",
        row.user_id,
      );
      if (!user || user.status !== "active") return null;
      await run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", now(), row.id);
      return { user, via: "api_key", apiKeyId: row.id };
    }
    return null;
  }

  const user = await currentUser();
  return user ? { user, via: "session" } : null;
}

export async function requireAuth(req: Request | NextRequest): Promise<AuthContext> {
  const ctx = await authenticate(req);
  if (!ctx) throw new HttpError(401, "Authentication required");
  return ctx;
}

export async function requireAdminApi(req: Request | NextRequest): Promise<AuthContext> {
  const ctx = await requireAuth(req);
  if (ctx.user.role !== "admin") throw new HttpError(403, "Administrator role required");
  return ctx;
}

/** Wraps a route handler with uniform error → JSON mapping. */
export function handler<A extends unknown[]>(
  fn: (req: NextRequest, ...rest: A) => Promise<Response>,
): (req: NextRequest, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    try {
      return await fn(req, ...rest);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
      console.error("[api] unhandled error", err);
      return fail(500, "Internal server error");
    }
  };
}
