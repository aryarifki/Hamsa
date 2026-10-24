import { newId, now, one, run } from "./db";
import { verifyPassword } from "./crypto";

/**
 * Pure user/credential logic. Deliberately free of `next/*` imports so it can be
 * exercised by the test suite and the seed script outside a request context.
 */

export type Role = "admin" | "analyst" | "viewer";

/** The requested "researcher" role maps onto Hamsa's existing `analyst`. */
export const isOperator = (role: string): boolean => role === "admin" || role === "analyst";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  credits: number;
  created_at: string;
  last_login_at: string | null;
}

const USER_COLUMNS = "id, email, name, role, status, credits, created_at, last_login_at";

export async function userByEmail(email: string): Promise<(User & { password_hash: string }) | undefined> {
  return one<User & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`,
    email.trim().toLowerCase(),
  );
}

export async function userById(id: string): Promise<User | undefined> {
  return one<User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, id);
}

/** Verifies credentials. Always performs a hash comparison to blunt user-enumeration timing. */
export async function checkCredentials(email: string, password: string): Promise<User | null> {
  const row = await userByEmail(email);
  if (!row) {
    verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) return null;
  if (row.status !== "active") return null;
  const stamp = now();
  await run("UPDATE users SET last_login_at = ? WHERE id = ?", stamp, row.id);
  const { password_hash: _ignored, ...user } = row;
  return { ...user, last_login_at: stamp };
}

export async function createUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  role?: Role;
  credits?: number;
}): Promise<User> {
  const id = newId();
  await run(
    "INSERT INTO users (id, email, name, password_hash, role, credits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    input.email.trim().toLowerCase(),
    input.name,
    input.passwordHash,
    input.role ?? "analyst",
    input.credits ?? 0,
    now(),
  );
  return (await userById(id))!;
}

export const isAdmin = (user: User | null): boolean => user?.role === "admin";
