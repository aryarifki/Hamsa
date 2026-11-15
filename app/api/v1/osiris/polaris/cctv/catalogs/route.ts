import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { runtimeCameras, RUNTIME_CATALOG_SLUGS } from "@/lib/polaris/cctv-server";
import type { PolarisCamera } from "@/lib/polaris/cctv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runtime CCTV catalogs (Phone-X parity).
 *
 * Serves the dumped per-city catalogs the Phone-X bundle fetches at runtime.
 * Slugs with no dump (`salatiga` — persistently 502 upstream) are reported as
 * unavailable so the client shows the same empty state Phone-X shows.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const catalogs: Record<string, { cameras: PolarisCamera[]; available: boolean }> = {};
    for (const slug of RUNTIME_CATALOG_SLUGS) {
      const cameras = runtimeCameras(slug);
      catalogs[slug] = { cameras: cameras ?? [], available: cameras !== null };
    }
    return ok({ catalogs, unavailable: ["salatiga"] });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] polaris catalogs failed", err);
    return fail(500, "Catalogs unavailable");
  }
}
