import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { bmkgEarthquakes, gdacsDisasters, fireDetections } from "@/lib/intel/situational";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    const [quakes, disasters, fires] = await Promise.all([
      bmkgEarthquakes(),
      gdacsDisasters(),
      fireDetections(),
    ]);
    return ok({ quakes, disasters, fires, fetchedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] bmkg failed", err);
    return fail(502, "Hazard feeds unavailable");
  }
}
