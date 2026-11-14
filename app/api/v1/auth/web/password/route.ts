import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { AuthError, setPassword } from "@/lib/auth-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ password: z.string().min(10).max(400) });

/** Lets an OTP-only account add a password so it can also sign in directly. */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    enforceRate(req, `auth-password:${user.id}`, 5, 60_000);

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "Password must be at least 10 characters");

    await setPassword(user.id, parsed.data.password);
    return ok({ updated: true, requiresPassword: false });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.status, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[auth] set-password failed", err);
    return fail(500, "Password could not be set");
  }
}
