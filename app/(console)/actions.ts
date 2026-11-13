"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requireAdmin, requireOperator, userById } from "@/lib/auth";
import { newId, now, one, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { createApiKey, revokeApiKey, upsertProvider } from "@/lib/security";
import { grant } from "@/lib/tokens";
import { markAllRead } from "@/lib/notify";
import { registerDevice, revokeDevice, deleteDevice } from "@/lib/track/consent";
import { createGeofence, deleteGeofence } from "@/lib/track/geofence";
import {
  captureCamera,
  checkCamera,
  createCamera,
  deleteCamera,
  enableCamera,
  pollCameraEvents,
} from "@/lib/cctv/service";

/* ───────────────────────────── Cases ───────────────────────────── */

export async function createCaseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim();
  const authorizationRef = String(formData.get("authorization_ref") ?? "").trim();
  if (!title) throw new Error("Case title is required");
  if (purpose.length < 10) throw new Error("Describe the purpose (at least 10 characters)");
  if (authorizationRef.length < 3) throw new Error("Authorization reference is required");

  const id = newId();
  const count = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM cases WHERE user_id = ?", user.id);
  const code = `H-${new Date().getFullYear()}-${String((count?.n ?? 0) + 1).padStart(4, "0")}`;

  await run(
    `INSERT INTO cases (id, user_id, code, title, subject, purpose, authorization_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    user.id,
    code,
    title,
    subject || null,
    purpose,
    authorizationRef,
    now(),
  );

  await audit({
    userId: user.id,
    actor: user.email,
    action: "case.create",
    entity: "case",
    entityId: id,
    meta: { code, title },
  });

  revalidatePath("/cases");
}

export async function closeCaseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  await run(
    "UPDATE cases SET status = 'closed', closed_at = ? WHERE id = ? AND user_id = ? AND status = 'open'",
    now(),
    id,
    user.id,
  );
  await audit({ userId: user.id, actor: user.email, action: "case.close", entity: "case", entityId: id });
  revalidatePath(`/cases/${id}`);
  revalidatePath("/cases");
}

export async function deleteCaseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  await run("DELETE FROM cases WHERE id = ? AND user_id = ?", id, user.id);
  await audit({ userId: user.id, actor: user.email, action: "case.delete", entity: "case", entityId: id });
  revalidatePath("/cases");
}

export async function attachLookupAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = String(formData.get("caseId") ?? "");
  const lookupId = String(formData.get("lookupId") ?? "");
  const ownedCase = await one<{ id: string }>("SELECT id FROM cases WHERE id = ? AND user_id = ?", caseId, user.id);
  const ownedLookup = await one<{ id: string }>(
    "SELECT id FROM lookups WHERE id = ? AND user_id = ?",
    lookupId,
    user.id,
  );
  if (!ownedCase || !ownedLookup) throw new Error("Not found");

  await run(
    "INSERT INTO case_items (case_id, lookup_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    caseId,
    lookupId,
    now(),
  );
  await audit({
    userId: user.id,
    actor: user.email,
    action: "case.add_item",
    entity: "case",
    entityId: caseId,
    meta: { lookupId },
  });
  revalidatePath(`/cases/${caseId}`);
}

export async function detachLookupAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = String(formData.get("caseId") ?? "");
  const lookupId = String(formData.get("lookupId") ?? "");
  const owned = await one<{ id: string }>("SELECT id FROM cases WHERE id = ? AND user_id = ?", caseId, user.id);
  if (!owned) throw new Error("Not found");
  await run("DELETE FROM case_items WHERE case_id = ? AND lookup_id = ?", caseId, lookupId);
  revalidatePath(`/cases/${caseId}`);
}

/* ───────────────────────────── API keys ───────────────────────────── */

export interface KeyState {
  token?: string;
  error?: string;
}

export async function createKeyAction(_prev: KeyState, formData: FormData): Promise<KeyState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 3) return { error: "Give the key a descriptive name." };
  const { token } = await createApiKey(user.id, name);
  await audit({
    userId: user.id,
    actor: user.email,
    action: "key.create",
    entity: "api_key",
    meta: { name },
  });
  revalidatePath("/settings");
  return { token };
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (await revokeApiKey(id, user.id)) {
    await audit({ userId: user.id, actor: user.email, action: "key.revoke", entity: "api_key", entityId: id });
  }
  revalidatePath("/settings");
}

/* ───────────────────────────── Watchlist ───────────────────────────── */

export async function addWatchAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const module = String(formData.get("module") ?? "phone");
  const target = String(formData.get("target") ?? "").trim();
  const interval = Math.max(1, Number(formData.get("interval_hours") ?? 24));
  if (!target) throw new Error("Target is required");
  if (!["phone", "ip", "email", "username", "telegram"].includes(module)) throw new Error("Invalid module");

  const id = newId();
  await run(
    "INSERT INTO watchlist (id, user_id, module, target, interval_hours, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    user.id,
    module,
    target,
    interval,
    now(),
  );
  await audit({ userId: user.id, actor: user.email, action: "watch.add", entity: "watchlist", entityId: id });
  revalidatePath("/watchlist");
}

export async function removeWatchAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  await run("DELETE FROM watchlist WHERE id = ? AND user_id = ?", id, user.id);
  await audit({ userId: user.id, actor: user.email, action: "watch.remove", entity: "watchlist", entityId: id });
  revalidatePath("/watchlist");
}

/* ───────────────────── Consent-based devices ───────────────────── */

export interface DeviceState {
  token?: string;
  error?: string;
}

export async function createDeviceAction(_prev: DeviceState, formData: FormData): Promise<DeviceState> {
  const user = await requireOperator();
  const name = String(formData.get("name") ?? "").trim();
  const consentRef = String(formData.get("consent_ref") ?? "").trim();

  try {
    // The token is deliberately scoped to the owner: an analyst can enrol a
    // device for a colleague, but the notifications and history belong to the
    // person who consented.
    const ownerId = String(formData.get("owner_user_id") ?? "").trim() || user.id;
    if (ownerId !== user.id && user.role !== "admin") {
      return { error: "Only an administrator can enrol a device for another user." };
    }
    if (!(await userById(ownerId))) return { error: "Owner not found." };

    const { token } = await registerDevice({
      ownerUserId: ownerId,
      name,
      consentRef,
      actor: user,
    });
    revalidatePath("/tracking");
    return { token };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function revokeDeviceAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const id = String(formData.get("id") ?? "");
  await revokeDevice(id, user);
  revalidatePath("/tracking");
}

export async function deleteDeviceAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const id = String(formData.get("id") ?? "");
  await deleteDevice(id, user);
  revalidatePath("/tracking");
}

/* ───────────────────────────── Geofences ───────────────────────────── */

export async function createFenceAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const deviceId = String(formData.get("device_id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const lat = Number(formData.get("lat"));
  const lon = Number(formData.get("lon"));
  const radius = Number(formData.get("radius_m") ?? 200);

  await createGeofence({ user, name, lat, lon, radiusM: radius, deviceId });
  revalidatePath("/tracking");
}

export async function deleteFenceAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const id = String(formData.get("id") ?? "");
  await deleteGeofence(id, user);
  revalidatePath("/tracking");
}

/* ───────────────────────────── Cameras ───────────────────────────── */

export interface CameraState {
  error?: string;
  ok?: boolean;
}

export async function createCameraAction(_prev: CameraState, formData: FormData): Promise<CameraState> {
  const user = await requireOperator();
  try {
    await createCamera({
      user,
      name: String(formData.get("name") ?? ""),
      streamUrl: String(formData.get("stream_url") ?? ""),
      onvifHost: String(formData.get("onvif_host") ?? "") || undefined,
      username: String(formData.get("username") ?? "") || undefined,
      password: String(formData.get("password") ?? "") || undefined,
      intervalSeconds: Number(formData.get("interval_seconds") ?? 300),
      motionThreshold: formData.get("motion_threshold")
        ? Number(formData.get("motion_threshold"))
        : null,
    });
    revalidatePath("/cctv");
    return { ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function checkCameraAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const id = String(formData.get("id") ?? "");
  await checkCamera(id, user);
  revalidatePath("/cctv");
}

export async function captureCameraAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const id = String(formData.get("id") ?? "");
  await captureCamera(id, user);
  revalidatePath("/cctv");
}

export async function pollCameraAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const id = String(formData.get("id") ?? "");
  await pollCameraEvents(id, user);
  revalidatePath("/cctv");
}

export async function enableCameraAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const id = String(formData.get("id") ?? "");
  await enableCamera(id, user);
  revalidatePath("/cctv");
}

export async function deleteCameraAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const id = String(formData.get("id") ?? "");
  await deleteCamera(id, user);
  revalidatePath("/cctv");
}

/* ──────────────────────────── Notifications ──────────────────────────── */

export async function markNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  await markAllRead(user.id);
  revalidatePath("/notifications");
  revalidatePath("/");
}

/* ───────────────────────────── Admin ───────────────────────────── */

export async function updateUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!(await userById(id))) throw new Error("User not found");
  if (id === admin.id && status === "suspended") throw new Error("You cannot suspend your own account");
  if (!["admin", "analyst", "viewer"].includes(role)) throw new Error("Invalid role");
  if (!["active", "suspended"].includes(status)) throw new Error("Invalid status");
  if (id === admin.id && role !== "admin") throw new Error("You cannot remove your own administrator role");
  if (role !== "admin" || status !== "active") {
    const target = await one<{ role: string; status: string }>("SELECT role, status FROM users WHERE id = ?", id);
    if (target?.role === "admin" && target.status === "active") {
      const count = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'");
      if ((count?.n ?? 0) <= 1) throw new Error("At least one active administrator must remain");
    }
  }
  await run("UPDATE users SET role = ?, status = ? WHERE id = ?", role, status, id);
  await audit({
    userId: admin.id,
    actor: admin.email,
    action: "admin.user_update",
    entity: "user",
    entityId: id,
    meta: { role, status },
  });
  revalidatePath("/admin");
}

export async function grantCreditsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const amount = Math.trunc(Number(formData.get("amount") ?? 0));
  if (!Number.isFinite(amount) || amount === 0) throw new Error("Enter a non-zero amount");
  if (Math.abs(amount) > 100_000) throw new Error("Amount too large");
  if (!(await userById(id))) throw new Error("User not found");
  await grant(id, amount, `admin:${admin.email}`);
  await audit({
    userId: admin.id,
    actor: admin.email,
    action: "billing.grant",
    entity: "user",
    entityId: id,
    meta: { amount },
  });
  revalidatePath("/admin");
}

export async function updateProviderAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const kind = String(formData.get("kind") ?? "");
  const name = String(formData.get("name") ?? "");
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const enabled = formData.get("enabled") === "on";
  if (!["ip", "phone", "email"].includes(kind)) throw new Error("Invalid provider kind");
  await upsertProvider({ kind, name, apiKey, enabled });
  await audit({
    userId: admin.id,
    actor: admin.email,
    action: "admin.provider_update",
    entity: "provider",
    meta: { kind, name, enabled },
  });
  revalidatePath("/admin");
}
