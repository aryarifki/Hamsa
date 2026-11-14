import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { balanceSnapshot } from "@/lib/tokens-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current identity + balance, matching Phone-X's `/me` payload shape. */
export async function GET(req: NextRequest) {
  try {
    const { user, via } = await requireAuth(req);
    const snapshot = await balanceSnapshot(user.id);
    return ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        credits: snapshot.balance,
      },
      balance: snapshot.balance,
      pendingTopups: snapshot.pendingTopups,
      via,
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[auth] me failed", err);
    return fail(500, "Session unavailable");
  }
}
