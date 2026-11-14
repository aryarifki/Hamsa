import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { chainByCode, chainOpen, revokeChain, ChainError } from "@/lib/track/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public metadata for the share page — never the reports themselves. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const chain = await chainByCode(code);
    if (!chain) return fail(404, "Chain not found", { code: "CHAIN_NOT_FOUND" });
    return ok({
      code: chain.code,
      label: chain.label,
      open: chainOpen(chain),
      expiresAt: chain.expires_at,
      createdAt: chain.created_at,
    });
  } catch (err) {
    console.error("[geofint] chain read failed", err);
    return fail(500, "Chain unavailable");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { user } = await requireAuth(req);
    const { code } = await params;
    const chain = await chainByCode(code);
    if (!chain) return fail(404, "Chain not found", { code: "CHAIN_NOT_FOUND" });
    await revokeChain(chain.id, user);
    return ok({ revoked: true, code: chain.code });
  } catch (err) {
    if (err instanceof ChainError) return fail(err.status, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[geofint] revoke failed", err);
    return fail(500, "Chain could not be revoked");
  }
}
