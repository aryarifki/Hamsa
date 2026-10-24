import { randomUUID } from "node:crypto";
import { all, newId, now, one, run } from "../db";
import { sha256 } from "../crypto";
import { audit } from "../audit";
import type { User } from "../users";

/**
 * Consent-based tracking, device side.
 *
 * A `tracked_devices` row is created by an operator for a named owner. The
 * system mints a UUID token, stores only its SHA-256 digest, and returns the
 * token to the caller exactly once. Revoking sets `revoked_at`; the lookup used
 * by the ingest endpoint filters revoked rows, so a revoked token is
 * indistinguishable from a forged one (403, no detail).
 */

export interface TrackedDevice {
  id: string;
  owner_user_id: string;
  name: string;
  consent_token_hash: string;
  consent_ts: string;
  consent_ref: string | null;
  created_by: string | null;
  revoked_at: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_lat: number | null;
  last_lon: number | null;
  last_accuracy: number | null;
  last_battery: number | null;
}

export async function registerDevice(input: {
  ownerUserId: string;
  name: string;
  consentRef: string;
  actor: User;
}): Promise<{ device: TrackedDevice; token: string }> {
  const name = input.name.trim();
  const consentRef = input.consentRef.trim();
  if (name.length < 2) throw new Error("Device name is too short");
  if (consentRef.length < 5) {
    throw new Error("Record the consent reference (signed form, ticket, or contract ID)");
  }

  const token = randomUUID();
  const id = newId();
  const stamp = now();

  await run(
    `INSERT INTO tracked_devices
       (id, owner_user_id, name, consent_token_hash, consent_ts, consent_ref, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.ownerUserId,
    name,
    sha256(token),
    stamp,
    consentRef,
    input.actor.id,
    stamp,
  );

  await audit({
    userId: input.actor.id,
    actor: input.actor.email,
    action: "device.create",
    entity: "tracked_device",
    entityId: id,
    meta: { name, ownerUserId: input.ownerUserId },
  });
  await audit({
    userId: input.actor.id,
    actor: input.actor.email,
    action: "device.consent",
    entity: "tracked_device",
    entityId: id,
    meta: { consentRef, consentTs: stamp },
  });

  return { device: (await deviceById(id))!, token };
}

export async function deviceById(id: string): Promise<TrackedDevice | undefined> {
  return one<TrackedDevice>("SELECT * FROM tracked_devices WHERE id = ?", id);
}

/** Admins see every kit; an analyst sees what they own or enrolled. */
export async function deviceForUser(id: string, user: User): Promise<TrackedDevice | undefined> {
  const device = await deviceById(id);
  if (!device) return undefined;
  if (user.role === "admin") return device;
  return device.owner_user_id === user.id || device.created_by === user.id ? device : undefined;
}

export async function listDevices(user: User): Promise<TrackedDevice[]> {
  if (user.role === "admin") {
    return all<TrackedDevice>("SELECT * FROM tracked_devices ORDER BY created_at DESC");
  }
  return all<TrackedDevice>(
    "SELECT * FROM tracked_devices WHERE owner_user_id = ? OR created_by = ? ORDER BY created_at DESC",
    user.id,
    user.id,
  );
}

/** Consumes a bearer token. Revoked rows are excluded by design. */
export async function findDeviceByToken(token: string): Promise<TrackedDevice | undefined> {
  if (!token || token.length > 200) return undefined;
  return one<TrackedDevice>(
    "SELECT * FROM tracked_devices WHERE consent_token_hash = ? AND revoked_at IS NULL",
    sha256(token),
  );
}

export async function revokeDevice(id: string, actor: User): Promise<boolean> {
  const device = await deviceForUser(id, actor);
  if (!device) throw new Error("Device not found");
  if (device.revoked_at) return false;

  await run("UPDATE tracked_devices SET revoked_at = ? WHERE id = ?", now(), id);
  await audit({
    userId: actor.id,
    actor: actor.email,
    action: "device.revoke",
    entity: "tracked_device",
    entityId: id,
    meta: { name: device.name },
  });
  return true;
}

export async function deleteDevice(id: string, actor: User): Promise<void> {
  const device = await deviceForUser(id, actor);
  if (!device) throw new Error("Device not found");

  await run("DELETE FROM tracked_devices WHERE id = ?", id);
  await audit({
    userId: actor.id,
    actor: actor.email,
    action: "device.delete",
    entity: "tracked_device",
    entityId: id,
    meta: { name: device.name, revoked: Boolean(device.revoked_at) },
  });
}
