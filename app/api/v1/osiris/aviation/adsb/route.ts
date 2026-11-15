import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { adsbFlights } from "@/lib/intel/situational";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    const lat = Number(req.nextUrl.searchParams.get("lat") ?? -6.2);
    const lon = Number(req.nextUrl.searchParams.get("lon") ?? 106.8);
    const dist = Number(req.nextUrl.searchParams.get("dist") ?? 120);
    const { feed, aircraft } = await adsbFlights(
      Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : -6.2,
      Number.isFinite(lon) ? Math.max(-180, Math.min(180, lon)) : 106.8,
      Number.isFinite(dist) ? Math.max(5, Math.min(250, dist)) : 120,
    );
    return ok({ feed, aircraft, count: aircraft.length });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] adsb failed", err);
    return fail(502, "ADS-B feed unavailable");
  }
}
