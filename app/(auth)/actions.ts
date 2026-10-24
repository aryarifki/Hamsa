"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkCredentials, createSession, createUser, SESSION_COOKIE } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { grant } from "@/lib/tokens";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { one } from "@/lib/db";

export interface AuthState {
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function requestMeta() {
  const h = await headers();
  return {
    ip:
      h.get("cf-connecting-ip") ||
      h.get("x-real-ip") ||
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown",
    ua: h.get("user-agent") ?? "unknown",
  };
}

function throttled(key: string): boolean {
  const limit = Number(process.env.HAMSA_AUTH_RATE_LIMIT ?? 10);
  return !rateLimit(key, limit, 60_000).allowed;
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const { ip, ua } = await requestMeta();

  if (throttled(`login:${ip}`)) {
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

  if (throttled(`register:${ip}`)) {
    return { error: "Too many attempts. Wait a minute and try again." };
  }
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (name.length < 2) return { error: "Name must be at least 2 characters." };
  if (password.length < 12) return { error: "Use a password of at least 12 characters." };
  if (!accept) return { error: "You must accept the acceptable-use terms." };
  if (await one("SELECT id FROM users WHERE email = ?", email)) {
    return { error: "An account with that email already exists." };
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
