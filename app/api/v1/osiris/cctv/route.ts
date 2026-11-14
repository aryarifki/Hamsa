import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { CITIES, catalogFor } from "@/lib/cctv/public-feeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists all catalogued cities and whether a stream is actually configured. */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const cities = CITIES.map((city) => {
      const catalog = catalogFor(city.slug);
      return {
        slug: city.slug,
        name: city.name,
        province: city.province,
        portal: city.portal,
        envKey: city.envKey,
        available: Boolean(catalog?.cameras.length),
        cameraCount: catalog?.cameras.length ?? 0,
        warnings: catalog?.warnings ?? [],
      };
    });
    return ok({ count: cities.length, available: cities.filter((c) => c.available).length, cities });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] cctv catalogue failed", err);
    return fail(500, "Catalogue unavailable");
  }
}
