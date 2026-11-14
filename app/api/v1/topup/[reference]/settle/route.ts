import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { TopupError, publicTopup, settleTopup } from "@/lib/tokens-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual settlement is admin-only on purpose: a user must not be able to mark
 * their own invoice paid. Automated settlement arrives through the signed
 * webhook; an administrator uses this after checking the bank/PJSP statement.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  try {
    const { user } = await requireAuth(req);
    if (user.role !== "admin") {
      return fail(403, "Only an administrator can settle a top-up manually");
    }
    enforceRate(req, `topup-settle:${user.id}`, 30, 60_000);

    const { reference } = await params;
    const result = await settleTopup(reference, { settledBy: `admin:${user.email}` });

    return ok({
      topup: publicTopup(result.topup),
      alreadySettled: result.alreadySettled,
      balance: result.balance,
    });
  } catch (err) {
    if (err instanceof TopupError) return fail(err.status, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[topup] settle failed", err);
    return fail(500, "Top-up could not be settled");
  }
}
