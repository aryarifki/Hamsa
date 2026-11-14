import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { catalogFor } from "@/lib/cctv/public-feeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ city: string }> }) {
  try {
    await requireAuth(req);
    const { city } = await params;
    const catalog = catalogFor(city);
    if (!catalog) return fail(404, "Unknown city");
    return ok({
      city: catalog.city,
      cameras: catalog.cameras.map((camera) => ({
        id: camera.id,
        name: camera.name,
        kind: camera.kind,
        available: camera.available,
        portal: camera.portal,
        frameUrl: camera.available ? `/api/v1/osiris/cctv/${camera.city}/${camera.id}/frame` : null,
      })),
      warnings: catalog.warnings,
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] cctv catalog failed", err);
    return fail(500, "Catalog unavailable");
  }
}
