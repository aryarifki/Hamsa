import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { newId, now, one, run } from "./db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { fetchJson } from "./intel/http";
import { audit } from "./audit";
import type { User } from "./users";

/**
 * Phone-X-compatible authentication.
 *
 * Phone-X signs users in with a phone number plus an OTP; email and password are
 * secondary. Hamsa keeps its email/password accounts and adds the same OTP flow
 * on top, so both clients work against one `users` table:
 *
 *  - OTP-first accounts get `phone` populated, `phone_verified_at` set, and a
 *    synthesized email (`<e164 digits>@otp.hamsa.local`) because the v1 schema
 *    requires one. The synthesized address is never mailed and cannot be used
 *    to log in with a password.
 *  - Every session created here is a normal row in `sessions`, so the cookie and
 *    the `x-session-token` header resolve to the same identity.
 */

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, message: string, code = "AUTH_ERROR", extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type OtpChannel = "whatsapp" | "sms" | "email";

export function normalizePhone(input: string, defaultCountry = "ID"): string {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry as never);
  if (!parsed || !parsed.isPossible()) {
    throw new AuthError(400, "Invalid phone number", "INVALID_PHONE");
  }
  return parsed.number;
}

function otpHash(phone: string, code: string): string {
  return sha256(`${phone}:${code}:${process.env.HAMSA_SECRET ?? "hamsa-dev-insecure-fallback"}`);
}

function generatedCode(): string {
  // Six digits, uniformly distributed, no modulo bias worth caring about here.
  const value = Number.parseInt(randomToken(8).replace(/\D/g, "").slice(0, 6) || "0", 10);
  return String((value || Math.floor(Math.random() * 1_000_000)) % 1_000_000).padStart(6, "0");
}

interface DeliveryResult {
  delivered: boolean;
  channel: OtpChannel;
  detail: string;
}

/**
 * Delivery is deliberately pluggable and honest:
 *
 *  - `OTP_WEBHOOK_URL` receives `{phone, channel, code}`. That is the single
 *    integration point for any SMS/WhatsApp gateway the operator runs.
 *  - `OTP_DEV_MODE=true` returns the code in the API response instead of
 *    pretending a message was sent. Never enable it in production.
 *  - Neither configured → the request fails with a clear instruction.
 */
async function deliverOtp(phone: string, channel: OtpChannel, code: string): Promise<DeliveryResult> {
  const webhook = process.env.OTP_WEBHOOK_URL?.trim();
  if (webhook) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = process.env.OTP_WEBHOOK_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      await fetchJson(webhook, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone, channel, code }),
        timeoutMs: 10_000,
      });
      return { delivered: true, channel, detail: "OTP forwarded to the configured gateway" };
    } catch (err) {
      throw new AuthError(502, `OTP gateway failed: ${(err as Error).message}`, "OTP_DELIVERY_FAILED");
    }
  }

  if (process.env.OTP_DEV_MODE === "true") {
    return { delivered: false, channel, detail: "OTP_DEV_MODE: the code is returned in this response" };
  }

  throw new AuthError(
    503,
    "No OTP delivery channel is configured. Set OTP_WEBHOOK_URL, or OTP_DEV_MODE=true for local testing.",
    "OTP_NOT_CONFIGURED",
  );
}

export async function requestOtp(input: {
  phone: string;
  channel?: OtpChannel;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ phone: string; channel: OtpChannel; expiresAt: string; devCode?: string; detail: string }> {
  const phone = normalizePhone(input.phone);
  const channel: OtpChannel = input.channel ?? "whatsapp";
  const code = generatedCode();
  const createdAt = now();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  // A new request invalidates every older unconsumed code for the number, so an
  // intercepted code cannot be replayed after the user asks for another.
  await run(
    "UPDATE otp_codes SET consumed_at = ? WHERE phone = ? AND consumed_at IS NULL",
    createdAt,
    phone,
  );

  await run(
    `INSERT INTO otp_codes (id, phone, code_hash, channel, purpose, attempts, consumed_at, expires_at, created_at, ip, user_agent)
     VALUES (?, ?, ?, ?, 'login', 0, NULL, ?, ?, ?, ?)`,
    newId(),
    phone,
    otpHash(phone, code),
    channel,
    expiresAt,
    createdAt,
    input.ip ?? null,
    (input.userAgent ?? "").slice(0, 300) || null,
  );

  const delivery = await deliverOtp(phone, channel, code);

  return {
    phone,
    channel,
    expiresAt,
    detail: delivery.detail,
    ...(process.env.OTP_DEV_MODE === "true" ? { devCode: code } : {}),
  };
}

export interface LoginResult {
  sessionToken: string;
  expiresAt: string;
  phoneNumber: string | null;
  requiresPassword: boolean;
  user: Pick<User, "id" | "email" | "name" | "role" | "credits">;
}

async function openSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null; deviceId?: string | null; deviceType?: string | null },
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await run(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent, device_id, device_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sha256(token),
    userId,
    now(),
    expiresAt,
    meta.ip ?? null,
    (meta.userAgent ?? "").slice(0, 400) || null,
    meta.deviceId ?? null,
    meta.deviceType ?? null,
  );
  return { token, expiresAt };
}

interface PhoneUserRow extends User {
  phone: string | null;
  requires_password: number;
}

async function userByPhone(phone: string): Promise<PhoneUserRow | undefined> {
  return one<PhoneUserRow>(
    `SELECT id, email, name, role, status, credits, created_at, last_login_at, phone, requires_password
       FROM users WHERE phone = ?`,
    phone,
  );
}

/**
 * Creates the account on first successful OTP verification. Credits start at 0:
 * a new account must top up before a billable lookup runs.
 */
async function createPhoneUser(phone: string, ip: string | null): Promise<PhoneUserRow> {
  const id = newId();
  const digits = phone.replace(/[^\d]/g, "");
  const email = `${digits}@otp.hamsa.local`;
  await run(
    `INSERT INTO users (id, email, name, password_hash, role, status, credits, created_at, phone, phone_verified_at)
     VALUES (?, ?, ?, '', 'analyst', 'active', 0, ?, ?, ?)`,
    id,
    email,
    phone,
    now(),
    phone,
    now(),
  );
  await audit({
    userId: id,
    actor: phone,
    action: "auth.register",
    entity: "user",
    entityId: id,
    meta: { method: "otp", ip },
  });
  return (await userByPhone(phone))!;
}

export async function verifyOtp(input: {
  phone: string;
  code: string;
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  deviceType?: string | null;
}): Promise<LoginResult> {
  const phone = normalizePhone(input.phone);
  const code = input.code.replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) throw new AuthError(400, "OTP must be six digits", "INVALID_OTP_FORMAT");

  const row = await one<{
    id: string;
    code_hash: string;
    attempts: number;
    expires_at: string;
    consumed_at: string | null;
  }>(
    `SELECT id, code_hash, attempts, expires_at, consumed_at
       FROM otp_codes WHERE phone = ?
      ORDER BY created_at DESC LIMIT 1`,
    phone,
  );

  if (!row || row.consumed_at) throw new AuthError(400, "Request a new code", "OTP_MISSING");
  if (Date.parse(row.expires_at) <= Date.now()) throw new AuthError(410, "Code expired", "OTP_EXPIRED");
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw new AuthError(429, "Too many attempts — request a new code", "OTP_LOCKED");
  }

  await run("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?", row.id);

  if (row.code_hash !== otpHash(phone, code)) {
    throw new AuthError(401, "Incorrect code", "OTP_INVALID", {
      attemptsLeft: OTP_MAX_ATTEMPTS - row.attempts - 1,
    });
  }

  await run("UPDATE otp_codes SET consumed_at = ? WHERE id = ?", now(), row.id);

  const existing = await userByPhone(phone);
  const user = existing ?? (await createPhoneUser(phone, input.ip ?? null));
  if (user.status !== "active") throw new AuthError(403, "Account is not active", "ACCOUNT_DISABLED");

  await run("UPDATE users SET last_login_at = ?, phone_verified_at = COALESCE(phone_verified_at, ?) WHERE id = ?", now(), now(), user.id);

  const session = await openSession(user.id, input);

  return {
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    phoneNumber: phone,
    requiresPassword: false,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, credits: user.credits },
  };
}

/** Identifier may be a phone number or an email address. */
export async function loginWithPassword(input: {
  identifier: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  deviceType?: string | null;
}): Promise<LoginResult> {
  const identifier = input.identifier.trim();
  if (!identifier || !input.password) throw new AuthError(400, "Identifier and password are required");

  let row: (PhoneUserRow & { password_hash: string }) | undefined;
  if (identifier.includes("@")) {
    row = await one<PhoneUserRow & { password_hash: string }>(
      `SELECT id, email, name, role, status, credits, created_at, last_login_at, phone, requires_password, password_hash
         FROM users WHERE email = ?`,
      identifier.toLowerCase(),
    );
  } else {
    try {
      const phone = normalizePhone(identifier);
      row = await one<PhoneUserRow & { password_hash: string }>(
        `SELECT id, email, name, role, status, credits, created_at, last_login_at, phone, requires_password, password_hash
           FROM users WHERE phone = ?`,
        phone,
      );
    } catch {
      row = undefined;
    }
  }

  if (!row || !row.password_hash || !verifyPassword(input.password, row.password_hash)) {
    throw new AuthError(401, "Invalid credentials", "INVALID_CREDENTIALS");
  }
  if (row.status !== "active") throw new AuthError(403, "Account is not active", "ACCOUNT_DISABLED");

  await run("UPDATE users SET last_login_at = ? WHERE id = ?", now(), row.id);
  const session = await openSession(row.id, input);

  return {
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    phoneNumber: row.phone,
    requiresPassword: Boolean(row.requires_password),
    user: { id: row.id, email: row.email, name: row.name, role: row.role, credits: row.credits },
  };
}

export async function setPassword(userId: string, password: string): Promise<void> {
  if (password.length < 10) throw new AuthError(400, "Password must be at least 10 characters", "WEAK_PASSWORD");
  await run("UPDATE users SET password_hash = ?, requires_password = 0 WHERE id = ?", hashPassword(password), userId);
  await audit({ userId, actor: userId, action: "auth.password.set", entity: "user", entityId: userId });
}

export async function revokeSessionToken(token: string): Promise<boolean> {
  if (!token) return false;
  const row = await one<{ id: string }>("SELECT id FROM sessions WHERE id = ?", sha256(token));
  if (!row) return false;
  await run("UPDATE sessions SET revoked_at = ? WHERE id = ?", now(), row.id);
  return true;
}

export interface BetaStatus {
  betaEnabled: boolean;
  registrationEnabled: boolean;
  registrationLimit: number | null;
  newBetaUsers: number;
  remainingSlots: number | null;
  isFull: boolean;
  registrationOpen: boolean;
}

/** Mirrors Phone-X's beta gate so a client can render the same state. */
export async function betaStatus(): Promise<BetaStatus> {
  const betaEnabled = process.env.HAMSA_BETA_ENABLED !== "false";
  const registrationEnabled = process.env.HAMSA_REGISTRATION_ENABLED === "true";
  const rawLimit = Number(process.env.HAMSA_REGISTRATION_LIMIT ?? "");
  const registrationLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : null;

  const row = await one<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM users WHERE beta_user = 1",
  );
  const newBetaUsers = row?.count ?? 0;
  const remainingSlots = registrationLimit === null ? null : Math.max(0, registrationLimit - newBetaUsers);

  return {
    betaEnabled,
    registrationEnabled,
    registrationLimit,
    newBetaUsers,
    remainingSlots,
    isFull: remainingSlots !== null && remainingSlots <= 0,
    registrationOpen: registrationEnabled && (remainingSlots === null || remainingSlots > 0),
  };
}
