import { all, newId, now, one, run } from "../db";
import { audit } from "../audit";
import { notify } from "../notify";
import { coordsLabel, haversineMeters, validLatLng } from "../intel/geo";
import type { User } from "../users";
import { deviceForUser, findDeviceByToken, type TrackedDevice } from "./consent";

/**
 * Consent-based geofence engine.
 *
 * Every accepted position update is evaluated against the fences that apply to
 * that device (device-scoped or org-wide) and transitions are appended to
 * `geofence_events`. The previous state is the latest event for the pair, so a
 * restart or a lost packet cannot produce a duplicate enter.
 */

export interface Geofence {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
  created_by: string | null;
  device_id: string | null;
  active: number;
  created_at: string;
}

export interface FenceStatus {
  id: string;
  name: string;
  inside: boolean;
  distanceM: number;
}

export interface GeofenceTransition {
  geofenceId: string;
  name: string;
  type: "enter" | "exit";
  distanceM: number;
}

export class TrackForbiddenError extends Error {}

/* ──────────────────────────────── fences ─────────────────────────────────── */

export async function listGeofences(user: User): Promise<Geofence[]> {
  if (user.role === "admin") {
    return all<Geofence>("SELECT * FROM geofences ORDER BY created_at DESC");
  }
  return all<Geofence>("SELECT * FROM geofences WHERE created_by = ? ORDER BY created_at DESC", user.id);
}

export async function createGeofence(input: {
  user: User;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  deviceId?: string | null;
}): Promise<Geofence> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Fence name is too short");
  if (!validLatLng(input.lat, input.lon)) throw new Error("Invalid coordinates");

  const radius = Math.max(20, Math.min(200_000, Math.round(input.radiusM)));
  const deviceId = input.deviceId?.trim() || null;
  if (!deviceId && input.user.role !== "admin") {
    throw new Error("Only administrators can create organisation-wide fences");
  }
  if (deviceId) {
    const device = await deviceForUser(deviceId, input.user);
    if (!device) throw new Error("Device not found");
  }

  const id = newId();
  await run(
    `INSERT INTO geofences (id, name, lat, lon, radius_m, created_by, device_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    input.lat,
    input.lon,
    radius,
    input.user.id,
    deviceId,
    now(),
  );

  await audit({
    userId: input.user.id,
    actor: input.user.email,
    action: "geofence.create",
    entity: "geofence",
    entityId: id,
    meta: { name, radiusM: radius, deviceId },
  });

  return (await one<Geofence>("SELECT * FROM geofences WHERE id = ?", id))!;
}

export async function deleteGeofence(id: string, user: User): Promise<void> {
  const fence = await one<Geofence>("SELECT * FROM geofences WHERE id = ?", id);
  if (!fence) throw new Error("Geofence not found");
  if (user.role !== "admin" && fence.created_by !== user.id) throw new Error("Geofence not found");

  await run("DELETE FROM geofences WHERE id = ?", id);
  await audit({
    userId: user.id,
    actor: user.email,
    action: "geofence.delete",
    entity: "geofence",
    entityId: id,
    meta: { name: fence.name },
  });
}

/* ────────────────────────────── evaluation ───────────────────────────────── */

export async function evaluateGeofences(
  device: TrackedDevice,
  lat: number,
  lon: number,
  ts: string,
): Promise<{ fences: FenceStatus[]; transitions: GeofenceTransition[] }> {
  const fences = await all<Geofence>(
    "SELECT * FROM geofences WHERE active = 1 AND (device_id IS NULL OR device_id = ?)",
    device.id,
  );

  const previous = await all<{ geofence_id: string; type: "enter" | "exit" }>(
    `SELECT DISTINCT ON (geofence_id) geofence_id, type
     FROM geofence_events
     WHERE device_id = ?
     ORDER BY geofence_id, ts DESC`,
    device.id,
  );
  const previousType = new Map(previous.map((row) => [row.geofence_id, row.type]));

  const statuses: FenceStatus[] = [];
  const transitions: GeofenceTransition[] = [];

  for (const fence of fences) {
    const distanceM = haversineMeters({ lat, lng: lon }, { lat: fence.lat, lng: fence.lon });
    const inside = distanceM <= fence.radius_m;
    statuses.push({ id: fence.id, name: fence.name, inside, distanceM: Math.round(distanceM) });

    const prior = previousType.get(fence.id);
    const type: "enter" | "exit" | null = inside && prior !== "enter" ? "enter" : !inside && prior === "enter" ? "exit" : null;
    if (!type) continue;

    await run(
      "INSERT INTO geofence_events (id, device_id, geofence_id, type, ts) VALUES (?, ?, ?, ?, ?)",
      newId(),
      device.id,
      fence.id,
      type,
      ts,
    );

    await audit({
      userId: device.owner_user_id,
      actor: `device:${device.name}`,
      action: type === "enter" ? "geofence.enter" : "geofence.exit",
      entity: "geofence",
      entityId: fence.id,
      meta: { deviceId: device.id, deviceName: device.name, distanceM: Math.round(distanceM) },
    });

    await notify(device.owner_user_id, {
      kind: `geofence.${type}`,
      title: `${device.name} ${type === "enter" ? "entered" : "left"} ${fence.name}`,
      body: `${coordsLabel(lat, lon)} · ${Math.round(distanceM)} m from the centre (radius ${fence.radius_m} m).`,
      entity: "geofence",
      entityId: fence.id,
    });

    transitions.push({ geofenceId: fence.id, name: fence.name, type, distanceM: Math.round(distanceM) });
  }

  return { fences: statuses, transitions };
}

/* ─────────────────────────────── ingest ──────────────────────────────────── */

export interface LocationInput {
  lat: number;
  lon: number;
  accuracy?: number;
  battery?: number;
  ts?: string;
}

export interface LocationResult {
  device: TrackedDevice;
  ts: string;
  fences: FenceStatus[];
  transitions: GeofenceTransition[];
}

/**
 * The only write path for positions. The token is the capability: an invalid
 * or revoked token raises `TrackForbiddenError`, which the route maps to 403
 * without revealing whether the device ever existed.
 */
export async function recordLocation(token: string, input: LocationInput): Promise<LocationResult> {
  const device = await findDeviceByToken(token);
  if (!device) throw new TrackForbiddenError("Invalid or revoked device token");
  if (!validLatLng(input.lat, input.lon)) throw new Error("Invalid coordinates");

  const ts = input.ts ? new Date(input.ts).toISOString() : now();
  if (Number.isNaN(new Date(ts).getTime())) throw new Error("Invalid timestamp");

  await run(
    "INSERT INTO device_locations (id, device_id, lat, lon, ts, accuracy, battery) VALUES (?, ?, ?, ?, ?, ?, ?)",
    newId(),
    device.id,
    input.lat,
    input.lon,
    ts,
    input.accuracy ?? null,
    input.battery ?? null,
  );

  await run(
    `UPDATE tracked_devices
     SET last_seen_at = ?, last_lat = ?, last_lon = ?, last_accuracy = ?, last_battery = ?
     WHERE id = ?`,
    ts,
    input.lat,
    input.lon,
    input.accuracy ?? null,
    input.battery ?? null,
    device.id,
  );

  const evaluated = await evaluateGeofences(device, input.lat, input.lon, ts);

  return {
    device: {
      ...device,
      last_seen_at: ts,
      last_lat: input.lat,
      last_lon: input.lon,
      last_accuracy: input.accuracy ?? null,
      last_battery: input.battery ?? null,
    },
    ts,
    ...evaluated,
  };
}

export async function locationHistory(deviceId: string, limit = 50): Promise<
  Array<{ lat: number; lon: number; ts: string; accuracy: number | null; battery: number | null }>
> {
  return all(
    "SELECT lat, lon, ts, accuracy, battery FROM device_locations WHERE device_id = ? ORDER BY ts DESC LIMIT ?",
    deviceId,
    limit,
  );
}

export async function recentGeofenceEvents(
  user: User,
  limit = 20,
): Promise<Array<{ id: string; type: string; ts: string; device_name: string; fence_name: string }>> {
  const scope = user.role === "admin" ? "" : "WHERE d.owner_user_id = ?";
  return all(
    `SELECT e.id, e.type, e.ts, d.name AS device_name, g.name AS fence_name
     FROM geofence_events e
     JOIN tracked_devices d ON d.id = e.device_id
     JOIN geofences g ON g.id = e.geofence_id
     ${scope}
     ORDER BY e.ts DESC LIMIT ?`,
    ...(user.role === "admin" ? [] : [user.id]),
    limit,
  );
}
