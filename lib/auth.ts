import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { now, one, run } from "./db";
import { randomToken, sha256 } from "./crypto";
import { isOperator, type User } from "./users";

export type { Role, User } from "./users";
export { checkCredentials, createUser, isAdmin, isOperator, userByEmail, userById } from "./users";

export const SESSION_COOKIE = "hamsa_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

/** Sets the browser cookie for a token that was already persisted. */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.HAMSA_SECURE_COOKIES === "true" || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function createSession(userId: string, ip: string, userAgent: string): Promise<void> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await run(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
    sha256(token),
    userId,
    now(),
    expires,
    ip,
    userAgent.slice(0, 400),
  );
  await setSessionCookie(token);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await run("UPDATE sessions SET revoked_at = ? WHERE id = ?", now(), sha256(token));
  }
  store.delete(SESSION_COOKIE);
}

/** Resolves the signed-in user from the session cookie, or null. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await one<{ user_id: string; expires_at: string; revoked_at: string | null }>(
    "SELECT user_id, expires_at, revoked_at FROM sessions WHERE id = ?",
    sha256(token),
  );
  if (!row || row.revoked_at || row.expires_at < now()) return null;

  const { userById } = await import("./users");
  const user = await userById(row.user_id);
  if (!user || user.status !== "active") return null;
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

/**
 * Guards the two own-asset modules. `researcher` in the requirements maps to
 * Hamsa's existing `analyst` role; viewers are redirected like they are for
 * every other privileged page.
 */
export async function requireOperator(): Promise<User> {
  const user = await requireUser();
  if (!isOperator(user.role)) redirect("/");
  return user;
}
