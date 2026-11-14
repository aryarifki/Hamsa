import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { TopupError, cancelTopup, expireIfStale, publicTopup, topupByReference } from "@/lib/tokens-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner (or admin) reads one top-up — the client polls this after paying. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  try {
    const { user } = await requireAuth(req);
    const { reference } = await params;
    const row = await topupByReference(reference);
    if (!row) return fail(404, "Top-up not found", { code: "TOPUP_NOT_FOUND" });
    if (user.role !== "admin" && row.user_id !== user.id) {
      return fail(404, "Top-up not found", { code: "TOPUP_NOT_FOUND" });
    }
    return ok({ topup: publicTopup(await expireIfStale(row)) });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[topup] read failed", err);
    return fail(500, "Top-up unavailable");
  }
}

/** Abandons a pending top-up the account owner no longer intends to pay. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  try {
    const { user } = await requireAuth(req);
    const { reference } = await params;
    return ok({ topup: publicTopup(await cancelTopup(user.id, reference)) });
  } catch (err) {
    if (err instanceof TopupError) return fail(err.status, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[topup] cancel failed", err);
    return fail(500, "Top-up could not be cancelled");
  }
}
