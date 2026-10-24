import { z } from "zod";
import { sha256 } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { recordLocation, TrackForbiddenError } from "@/lib/track/geofence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).max(100_000).optional(),
    battery: z.number().min(0).max(100).optional(),
    ts: z.string().datetime().optional(),
  })
  .refine((value) => value.lon !== undefined || value.lng !== undefined, {
    message: "lon is required",
  });

const MAX_PER_MINUTE = 60;

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

/**
 * Consent-gated position ingest.
 *
 * The bearer token is the capability minted at enrolment; the server stores only
 * its SHA-256 digest. Invalid, unknown and revoked tokens all receive the same
 * 403 — the endpoint never confirms whether a device exists. Each token is
 * limited to 60 updates per minute.
 *
 * Written against the standard Request/Response types (not `NextRequest`) so the
 * handler can be exercised directly by the test suite.
 */
export async function POST(req: Request): Promise<Response> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Forbidden" }, 403);

  const limit = rateLimit(`track:${sha256(token).slice(0, 16)}`, MAX_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    return json({ error: "Too many location updates", retryAfter: limit.retryAfter }, 429);
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid location payload" }, 400);

  const { lat, accuracy, battery, ts } = parsed.data;
  const lon = parsed.data.lon ?? parsed.data.lng!;

  try {
    const result = await recordLocation(token, { lat, lon, accuracy, battery, ts });
    return json({
      receivedAt: result.ts,
      device: { id: result.device.id, name: result.device.name },
      fences: result.fences.map((fence) => ({
        id: fence.id,
        name: fence.name,
        inside: fence.inside,
        distanceMeters: fence.distanceM,
      })),
      transitions: result.transitions.map((transition) => ({
        geofenceId: transition.geofenceId,
        name: transition.name,
        type: transition.type,
        distanceMeters: transition.distanceM,
      })),
    });
  } catch (err) {
    if (err instanceof TrackForbiddenError) return json({ error: "Forbidden" }, 403);
    const message = (err as Error).message;
    if (/coordinate|timestamp/i.test(message)) return json({ error: message }, 400);
    console.error("[track] location update failed:", message);
    return json({ error: "Location update failed" }, 500);
  }
}
