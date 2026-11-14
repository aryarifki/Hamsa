import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { chainByCode, chainForUser, ChainError } from "@/lib/track/chain";
import { decodeImagePayload, extractExifGps } from "@/lib/track/geofence-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  filename: z.string().trim().max(200).optional(),
  imageBase64: z.string().min(16).max(16_000_000),
  radiusM: z.number().int().min(20).max(200_000).optional(),
});

/**
 * Geofence preview from an uploaded image.
 *
 * Phone-X's preview returns the fence implied by the upload. Native Hamsa reads
 * the EXIF GPS tag and returns a circle around it, or an explicit "no
 * coordinates in this file" — it does not infer a location from pixels.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { user } = await requireAuth(req);
    enforceRate(req, `geofint-preview:${user.id}`, 20, 60_000);

    const { code } = await params;
    const chain = await chainByCode(code);
    if (!chain) return fail(404, "Chain not found", { code: "CHAIN_NOT_FOUND" });
    await chainForUser(chain.id, user); // ownership check

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "Provide { filename, imageBase64 }");

    const bytes = decodeImagePayload(parsed.data.imageBase64);
    if (!bytes || bytes.length === 0) return fail(400, "imageBase64 did not decode to any bytes");

    const gps = extractExifGps(bytes);
    const radiusM = parsed.data.radiusM ?? 150;

    if (!gps.found) {
      return ok({
        code: chain.code,
        filename: parsed.data.filename ?? null,
        found: false,
        lat: null,
        lon: null,
        radiusM,
        warnings: gps.warnings.length
          ? gps.warnings
          : ["No GPS coordinates were found in the uploaded image."],
      });
    }

    return ok({
      code: chain.code,
      filename: parsed.data.filename ?? null,
      found: true,
      lat: gps.lat,
      lon: gps.lon,
      altitude: gps.altitude,
      radiusM,
      mapUrl: `https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=16/${gps.lat}/${gps.lon}`,
      warnings: gps.warnings,
    });
  } catch (err) {
    if (err instanceof ChainError) return fail(err.status, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[geofint] preview failed", err);
    return fail(500, "Preview failed");
  }
}
