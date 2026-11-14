import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, clientIp, userAgent } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { setSessionCookie } from "@/lib/auth";
import { AuthError, loginWithPassword } from "@/lib/auth-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** Phone-X sends both; either may carry the identifier. */
  identifier: z.string().trim().min(3).max(200).optional(),
  identity: z.string().trim().min(3).max(200).optional(),
  password: z.string().min(1).max(400),
});

export async function POST(req: NextRequest) {
  try {
    enforceRate(req, "auth-login", 10, 60_000);

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "Provide an identifier and password");

    const identifier = parsed.data.identifier ?? parsed.data.identity;
    if (!identifier) return fail(400, "Provide an identifier and password");

    const result = await loginWithPassword({
      identifier,
      password: parsed.data.password,
      ip: clientIp(req),
      userAgent: userAgent(req),
      deviceId: req.headers.get("x-device-id"),
      deviceType: req.headers.get("x-device-type"),
    });

    await setSessionCookie(result.sessionToken);

    return ok({
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      phoneNumber: result.phoneNumber,
      requiresPassword: result.requiresPassword,
      user: result.user,
    });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.status, err.message, { code: err.code, ...err.extra });
    console.error("[auth] login failed", err);
    return fail(500, "Login failed");
  }
}
