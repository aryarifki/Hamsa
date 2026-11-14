import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { assertPreview, PreviewError } from "@/lib/intel/preview";
import { openskyFlights } from "@/lib/intel/situational";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    assertPreview(user.id);
    const { feed, aircraft } = await openskyFlights();
    return ok({ feed, aircraft, count: aircraft.length });
  } catch (err) {
    if (err instanceof PreviewError) return fail(403, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] opensky failed", err);
    return fail(502, "Aviation feed unavailable");
  }
}
