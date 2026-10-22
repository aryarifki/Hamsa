"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireUser, requireAdmin, userById } from "@/lib/auth";
import { newId, now, one, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { createApiKey, revokeApiKey, upsertProvider } from "@/lib/security";
import { grant } from "@/lib/tokens";
import { probeCctv } from "@/lib/intel/cctv";
import { randomToken, sha256 } from "@/lib/crypto";

async function meta() {
  const h = await headers();
  return {
    ip: h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? undefined,
    ua: h.get("user-agent") ?? undefined,
  };
}

/* ───────────────────────────── Cases ───────────────────────────── */

export async function createCaseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim();
  const authorizationRef = String(formData.get("authorization_ref") ?? "").trim();

  if (title.length < 3) throw new Error("Case title is too short");
  if (purpose.length < 10) throw new Error("Describe the lawful purpose (at least 10 characters)");
  if (authorizationRef.length < 3) throw new Error("An authorization reference is required");

  const id = newId();
  const code = `CASE-${new Date().getFullYear()}-${id.slice(0, 6).toUpperCase()}`;
  run(
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

  const m = await meta();
  audit({
    userId: user.id,
    actor: user.email,
    action: "case.create",
    entity: "case",
    entityId: id,
    meta: { code, title },
    ...m,
  });
  revalidatePath("/cases");
  redirect(`/cases/${id}`);
}

export async function closeCaseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const owned = one<{ status: string }>("SELECT status FROM cases WHERE id = ? AND user_id = ?", id, user.id);
  if (!owned) throw new Error("Case not found");
  const next = owned.status === "open" ? "closed" : "open";
  run("UPDATE cases SET status = ?, closed_at = ? WHERE id = ?", next, next === "closed" ? now() : null, id);
  audit({ userId: user.id, actor: user.email, action: "case.close", entity: "case", entityId: id, meta: { status: next } });
  revalidatePath(`/cases/${id}`);
  revalidatePath("/cases");
}

export async function deleteCaseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const owned = one<{ id: string }>("SELECT id FROM cases WHERE id = ? AND user_id = ?", id, user.id);
  if (!owned) throw new Error("Case not found");
  run("DELETE FROM cases WHERE id = ?", id);
  audit({ userId: user.id, actor: user.email, action: "case.delete", entity: "case", entityId: id });
  revalidatePath("/cases");
  redirect("/cases");
}

export async function attachLookupAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = String(formData.get("caseId") ?? "");
  const lookupId = String(formData.get("lookupId") ?? "");
  const ownedCase = one("SELECT id FROM cases WHERE id = ? AND user_id = ?", caseId, user.id);
  const ownedLookup = one("SELECT id FROM lookups WHERE id = ? AND user_id = ?", lookupId, user.id);
  if (!ownedCase || !ownedLookup) throw new Error("Not found");
  run("INSERT OR IGNORE INTO case_items (case_id, lookup_id, added_at) VALUES (?, ?, ?)", caseId, lookupId, now());
  audit({ userId: user.id, actor: user.email, action: "case.add_item", entity: "case", entityId: caseId, meta: { lookupId } });
  revalidatePath(`/cases/${caseId}`);
}

export async function detachLookupAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = String(formData.get("caseId") ?? "");
  const lookupId = String(formData.get("lookupId") ?? "");
  if (!one("SELECT id FROM cases WHERE id = ? AND user_id = ?", caseId, user.id)) throw new Error("Not found");
  run("DELETE FROM case_items WHERE case_id = ? AND lookup_id = ?", caseId, lookupId);
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
  const { token } = createApiKey(user.id, name);
  audit({ userId: user.id, actor: user.email, action: "key.create", entity: "api_key", meta: { name } });
  revalidatePath("/settings");
  return { token };
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (revokeApiKey(id, user.id)) {
    audit({ userId: user.id, actor: user.email, action: "key.revoke", entity: "api_key", entityId: id });
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
  run(
    "INSERT INTO watchlist (id, user_id, module, target, interval_hours, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    user.id,
    module,
    target,
    interval,
    now(),
  );
  audit({ userId: user.id, actor: user.email, action: "watch.add", entity: "watchlist", entityId: id });
  revalidatePath("/watchlist");
}

export async function removeWatchAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  run("DELETE FROM watchlist WHERE id = ? AND user_id = ?", id, user.id);
  audit({ userId: user.id, actor: user.email, action: "watch.remove", entity: "watchlist", entityId: id });
  revalidatePath("/watchlist");
}

/* ───────────────────────────── Devices ───────────────────────────── */

export interface DeviceState {
  token?: string;
  error?: string;
}

export async function createDeviceAction(_prev: DeviceState, formData: FormData): Promise<DeviceState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const consentRef = String(formData.get("consent_ref") ?? "").trim();
  if (name.length < 2) return { error: "Device name is too short." };
  if (consentRef.length < 5) {
    return { error: "Record the consent reference (signed form, ticket, or contract ID)." };
  }

  const token = `dv_${randomToken(24)}`;
  const id = newId();
  run(
    `INSERT INTO devices (id, user_id, name, token_hash, consent_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    user.id,
    name,
    sha256(token),
    consentRef,
    now(),
  );
  audit({ userId: user.id, actor: user.email, action: "device.create", entity: "device", entityId: id, meta: { name } });
  revalidatePath("/tracking");
  return { token };
}

export async function deleteDeviceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  run("DELETE FROM devices WHERE id = ? AND user_id = ?", id, user.id);
  audit({ userId: user.id, actor: user.email, action: "device.delete", entity: "device", entityId: id });
  revalidatePath("/tracking");
}

export async function createFenceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const deviceId = String(formData.get("device_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const lat = Number(formData.get("lat"));
  const lng = Number(formData.get("lng"));
  const radius = Math.max(20, Number(formData.get("radius_m") ?? 200));
  if (!name) throw new Error("Fence name is required");
  if (!one("SELECT id FROM devices WHERE id = ? AND user_id = ?", deviceId, user.id)) throw new Error("Device not found");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Invalid coordinates");

  const id = newId();
  run(
    "INSERT INTO geofences (id, user_id, device_id, name, lat, lng, radius_m, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    user.id,
    deviceId,
    name,
    lat,
    lng,
    Math.round(radius),
    now(),
  );
  audit({ userId: user.id, actor: user.email, action: "geofence.create", entity: "geofence", entityId: id });
  revalidatePath("/tracking");
}

export async function deleteFenceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  run("DELETE FROM geofences WHERE id = ? AND user_id = ?", id, user.id);
  audit({ userId: user.id, actor: user.email, action: "geofence.delete", entity: "geofence", entityId: id });
  revalidatePath("/tracking");
}

/* ───────────────────────────── Cameras ───────────────────────────── */

export async function createCctvAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const endpoint = String(formData.get("endpoint") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!name) throw new Error("Camera name is required");
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Endpoint must be a full URL (rtsp:// or https://)");
  }
  if (!["rtsp:", "rtsps:", "http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only rtsp, rtsps, http and https endpoints are supported");
  }

  const id = newId();
  run(
    `INSERT INTO cctv_assets (id, user_id, name, protocol, endpoint_enc, username, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    user.id,
    name,
    parsed.protocol.replace(":", ""),
    encryptSecret(endpoint),
    username || null,
    now(),
  );
  audit({ userId: user.id, actor: user.email, action: "cctv.create", entity: "cctv", entityId: id });
  revalidatePath("/cctv");
}

export async function checkCctvAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const row = one<{ endpoint_enc: string; username: string | null }>(
    "SELECT endpoint_enc, username FROM cctv_assets WHERE id = ? AND user_id = ?",
    id,
    user.id,
  );
  if (!row) throw new Error("Camera not found");
  const { decryptSecret } = await import("@/lib/crypto");
  const endpoint = decryptSecret(row.endpoint_enc);
  const result = await probeCctv(endpoint, row.username);
  run(
    "UPDATE cctv_assets SET status = ?, last_checked_at = ? WHERE id = ?",
    result.online ? "online" : "offline",
    now(),
    id,
  );
  audit({
    userId: user.id,
    actor: user.email,
    action: "cctv.check",
    entity: "cctv",
    entityId: id,
    meta: { online: result.online, detail: result.detail },
  });
  revalidatePath("/cctv");
}

export async function deleteCctvAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  run("DELETE FROM cctv_assets WHERE id = ? AND user_id = ?", id, user.id);
  audit({ userId: user.id, actor: user.email, action: "cctv.delete", entity: "cctv", entityId: id });
  revalidatePath("/cctv");
}

/* ───────────────────────────── Admin ───────────────────────────── */

export async function updateUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!userById(id)) throw new Error("User not found");
  if (id === admin.id && status === "suspended") throw new Error("You cannot suspend your own account");
  if (!["admin", "analyst", "viewer"].includes(role)) throw new Error("Invalid role");
  if (!["active", "suspended"].includes(status)) throw new Error("Invalid status");
  run("UPDATE users SET role = ?, status = ? WHERE id = ?", role, status, id);
  audit({
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
  if (!userById(id)) throw new Error("User not found");
  grant(id, amount, `admin:${admin.email}`);
  audit({ userId: admin.id, actor: admin.email, action: "billing.grant", entity: "user", entityId: id, meta: { amount } });
  revalidatePath("/admin");
}

export async function updateProviderAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const kind = String(formData.get("kind") ?? "");
  const name = String(formData.get("name") ?? "");
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const enabled = formData.get("enabled") === "on";
  if (!["ip", "phone", "email"].includes(kind)) throw new Error("Invalid provider kind");
  upsertProvider({ kind, name, apiKey, enabled });
  audit({ userId: admin.id, actor: admin.email, action: "admin.provider_update", entity: "provider", meta: { kind, name, enabled } });
  revalidatePath("/admin");
}
