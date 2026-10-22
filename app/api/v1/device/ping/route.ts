import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { all, newId, now, one, run } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { haversineMeters, validLatLng } from "@/lib/intel/geo";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
  battery: z.number().min(0).max(100).optional(),
});

/**
 * Consent-gated position ingest.
 *
 * A device authenticates with the one-time token issued at enrolment. It can
 * only write its own position — there is no endpoint to look up a device by
 * phone number or to move another device.
 */
export async function POST(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer dv_")) return fail(401, "Device token required");
  const token = header.slice(7).trim();

  const device = one<{ id: string; user_id: string; name: string; active: number }>(
    "SELECT id, user_id, name, active FROM devices WHERE token_hash = ?",
    sha256(token),
  );
  if (!device || !device.active) return fail(401, "Unknown or revoked device token");

  const limit = rateLimit(`ping:${device.id}`, 120, 60_000);
  if (!limit.allowed) return fail(429, "Too many pings", { retryAfter: limit.retryAfter });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Invalid position payload");
  const { lat, lng, accuracy, battery } = parsed.data;
  if (!validLatLng(lat, lng)) return fail(400, "Coordinates out of range");

  run(
    "INSERT INTO device_pings (id, device_id, lat, lng, accuracy, battery, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    newId(),
    device.id,
    lat,
    lng,
    accuracy ?? null,
    battery ?? null,
    now(),
  );
  run(
    "UPDATE devices SET last_seen_at = ?, last_lat = ?, last_lng = ?, last_accuracy = ?, last_battery = ? WHERE id = ?",
    now(),
    lat,
    lng,
    accuracy ?? null,
    battery ?? null,
    device.id,
  );

  const fences = all<{ id: string; name: string; lat: number; lng: number; radius_m: number }>(
    "SELECT id, name, lat, lng, radius_m FROM geofences WHERE device_id = ? AND active = 1",
    device.id,
  );

  audit({
    userId: device.user_id,
    actor: `device:${device.name}`,
    action: "device.ping",
    entity: "device",
    entityId: device.id,
    meta: { lat, lng, accuracy: accuracy ?? null },
  });

  return ok({
    receivedAt: now(),
    fences: fences.map((f) => {
      const distance = Math.round(haversineMeters({ lat, lng }, { lat: f.lat, lng: f.lng }));
      return { id: f.id, name: f.name, inside: distance <= f.radius_m, distanceMeters: distance };
    }),
  });
}
