import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { previewStatus, startPreview, PreviewError } from "@/lib/intel/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    return ok(previewStatus(user.id));
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    return fail(500, "Preview status unavailable");
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    enforceRate(req, `polaris-preview:${user.id}`, 12, 60_000);
    return ok(startPreview(user.id));
  } catch (err) {
    if (err instanceof PreviewError) return fail(409, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] preview start failed", err);
    return fail(500, "Preview could not be started");
  }
}
