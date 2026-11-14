import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, clientIp, userAgent } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { AuthError, requestOtp, type OtpChannel } from "@/lib/auth-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phone: z.string().trim().min(6).max(24).optional(),
  /** Phone-X sends the number in either field depending on the form. */
  whatsapp: z.string().trim().min(6).max(24).optional(),
  email: z.string().trim().email().max(200).optional(),
  gmail: z.string().trim().max(200).optional(),
  channel: z.enum(["whatsapp", "sms", "email"]).optional(),
  turnstileToken: z.string().trim().max(4000).optional(),
});

/**
 * Optional Cloudflare Turnstile gate. When `HAMSA_TURNSTILE_SECRET` is set the
 * token is verified; when it is not, the endpoint stays open (self-hosted
 * deployments usually protect this with their own proxy).
 */
async function turnstileOk(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.HAMSA_TURNSTILE_SECRET?.trim();
  if (!secret) return true;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
      cache: "no-store",
    });
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    enforceRate(req, "auth-request-otp", 8, 60_000);

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "Provide a phone number");

    const phone = parsed.data.phone ?? parsed.data.whatsapp;
    if (!phone) return fail(400, "Provide a phone number");

    if (!(await turnstileOk(parsed.data.turnstileToken, ip))) {
      return fail(403, "Human verification failed", { code: "TURNSTILE_FAILED" });
    }

    const channel: OtpChannel = parsed.data.channel ?? "whatsapp";
    const result = await requestOtp({ phone, channel, ip, userAgent: userAgent(req) });

    return ok({
      channel: result.channel,
      phone: result.phone,
      expiresAt: result.expiresAt,
      detail: result.detail,
      ...(result.devCode ? { devCode: result.devCode } : {}),
    });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.status, err.message, { code: err.code, ...err.extra });
    console.error("[auth] request-otp failed", err);
    return fail(500, "OTP could not be requested");
  }
}
