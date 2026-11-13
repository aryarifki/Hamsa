"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkCredentials, createSession, createUser, SESSION_COOKIE } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { grant } from "@/lib/tokens";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { one } from "@/lib/db";
import { clientIpFromHeaders } from "@/lib/http";

export interface AuthState {
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function requestMeta() {
  const h = await headers();
  return {
    ip: clientIpFromHeaders(h),
    ua: h.get("user-agent") ?? "unknown",
  };
}

function throttled(key: string): boolean {
  const limit = Number(process.env.HAMSA_AUTH_RATE_LIMIT ?? 10);
  return !rateLimit(key, limit, 60_000).allowed;
}

function authThrottled(kind: "login" | "register", ip: string, email: string): boolean {
  // Check both keys; do not short-circuit so each bucket observes the attempt.
  const byIp = throttled(`${kind}:ip:${ip}`);
  const byEmail = throttled(`${kind}:email:${email}`);
  return byIp || byEmail;
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const { ip, ua } = await requestMeta();

  if (authThrottled("login", ip, email)) {
    return { error: "Too many attempts. Wait a minute and try again." };
  }
  if (!EMAIL_RE.test(email) || password.length < 1) {
    return { error: "Enter a valid email and password." };
  }

  const user = await checkCredentials(email, password);
  if (!user) {
    await audit({ action: "auth.login_failed", actor: email, ip, userAgent: ua, meta: { email } });
    return { error: "Invalid credentials." };
  }

  await createSession(user.id, ip, ua);
  await audit({ userId: user.id, actor: user.email, action: "auth.login", ip, userAgent: ua });
  redirect("/");
}

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const accept = formData.get("accept") === "on";
  const { ip, ua } = await requestMeta();

  if (authThrottled("register", ip, email)) {
    return { error: "Too many attempts. Wait a minute and try again." };
  }
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (name.length < 2) return { error: "Name must be at least 2 characters." };
  if (password.length < 12) return { error: "Use a password of at least 12 characters." };
  if (!accept) return { error: "You must accept the acceptable-use terms." };
  if (await one("SELECT id FROM users WHERE email = ?", email)) {
    return { error: "If that address can be used, an account can be created with it." };
  }

  const credits = Number(process.env.HAMSA_SIGNUP_CREDITS ?? 25);
  const user = await createUser({ email, name, passwordHash: hashPassword(password), credits: 0 });
  if (credits > 0) await grant(user.id, credits, "signup:bonus");

  await createSession(user.id, ip, ua);
  await audit({
    userId: user.id,
    actor: user.email,
    action: "auth.register",
    entity: "user",
    entityId: user.id,
    ip,
    userAgent: ua,
  });
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const { cookies } = await import("next/headers");
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
