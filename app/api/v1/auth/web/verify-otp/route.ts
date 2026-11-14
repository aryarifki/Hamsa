import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, clientIp, userAgent } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { setSessionCookie } from "@/lib/auth";
import { AuthError, verifyOtp } from "@/lib/auth-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phone: z.string().trim().min(6).max(24).optional(),
  whatsapp: z.string().trim().min(6).max(24).optional(),
  code: z.string().trim().min(4).max(10),
});

/**
 * Verifies the code and returns `{ sessionToken, ... }` like Phone-X does.
 * A cookie is set in the same response so the browser console works without
 * the client having to attach the header itself.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    enforceRate(req, "auth-verify-otp", 12, 60_000);

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "Provide the code that was sent");

    const phone = parsed.data.phone ?? parsed.data.whatsapp;
    if (!phone) return fail(400, "Provide a phone number");

    const result = await verifyOtp({
      phone,
      code: parsed.data.code,
      ip,
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
    console.error("[auth] verify-otp failed", err);
    return fail(500, "Code could not be verified");
  }
}
