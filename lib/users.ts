import { newId, now, one, run } from "./db";
import { verifyPassword } from "./crypto";

/**
 * Pure user/credential logic. Deliberately free of `next/*` imports so it can be
 * exercised by the test suite and the seed script outside a request context.
 */

export type Role = "admin" | "analyst" | "viewer";

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

export function userByEmail(email: string): (User & { password_hash: string }) | undefined {
  return one<User & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`,
    email.trim().toLowerCase(),
  );
}

export function userById(id: string): User | undefined {
  return one<User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, id);
}

/** Verifies credentials. Always performs a hash comparison to blunt user-enumeration timing. */
export function checkCredentials(email: string, password: string): User | null {
  const row = userByEmail(email);
  if (!row) {
    verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) return null;
  if (row.status !== "active") return null;
  run("UPDATE users SET last_login_at = ? WHERE id = ?", now(), row.id);
  const { password_hash: _ignored, ...user } = row;
  return user;
}

export function createUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  role?: Role;
  credits?: number;
}): User {
  const id = newId();
  run(
    "INSERT INTO users (id, email, name, password_hash, role, credits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    input.email.trim().toLowerCase(),
    input.name,
    input.passwordHash,
    input.role ?? "analyst",
    input.credits ?? 0,
    now(),
  );
  return userById(id)!;
}

export const isAdmin = (user: User | null): boolean => user?.role === "admin";
