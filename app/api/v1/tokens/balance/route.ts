import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { balanceSnapshot, listTopups, publicTopup } from "@/lib/tokens-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Balance + pending top-ups, the shape the Phone-X client polls after a purchase. */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    const snapshot = await balanceSnapshot(user.id);
    const recent = await listTopups(user.id, 10);
    return ok({
      ...snapshot,
      recent: recent.map(publicTopup),
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[tokens] balance failed", err);
    return fail(500, "Balance unavailable");
  }
}
