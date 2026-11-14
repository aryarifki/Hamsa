import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { destroySession } from "@/lib/auth";
import { revokeSessionToken } from "@/lib/auth-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revokes the session whether it arrived as a cookie or as `x-session-token`,
 * then clears the cookie. Both paths are attempted so a client that uses the
 * header exclusively still ends up signed out.
 */
export async function POST(req: NextRequest) {
  try {
    const headerToken = req.headers.get("x-session-token")?.trim();
    const bearer = req.headers.get("authorization")?.startsWith("Bearer ")
      ? req.headers.get("authorization")!.slice(7).trim()
      : "";

    let revoked = false;
    for (const token of [headerToken, bearer]) {
      if (token) revoked = (await revokeSessionToken(token)) || revoked;
    }

    await destroySession();
    return ok({ loggedOut: true, revoked });
  } catch (err) {
    console.error("[auth] logout failed", err);
    return fail(500, "Logout failed");
  }
}
