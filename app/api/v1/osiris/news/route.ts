import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { assertPreview, PreviewError } from "@/lib/intel/preview";
import { newsFeed } from "@/lib/intel/situational";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    assertPreview(user.id);
    const query = req.nextUrl.searchParams.get("q") ?? "";
    return ok(await newsFeed(query.slice(0, 120)));
  } catch (err) {
    if (err instanceof PreviewError) return fail(403, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] news failed", err);
    return fail(502, "News feed unavailable");
  }
}
