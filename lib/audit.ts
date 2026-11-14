import { newId, now, run } from "./db";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
  | "auth.password_change"
  | "auth.password.set"
  | "auth.register"
  | "lookup.run"
  | "lookup.denied"
  | "case.create"
  | "case.close"
  | "case.delete"
  | "case.add_item"
  | "billing.grant"
  | "billing.topup"
  | "admin.user_update"
  | "admin.provider_update"
  | "key.create"
  | "key.revoke"
  | "watch.add"
  | "watch.remove"
  | "device.create"
  | "device.consent"
  | "device.revoke"
  | "device.delete"
  | "geofence.create"
  | "geofence.delete"
  | "geofence.enter"
  | "geofence.exit"
  | "camera.create"
  | "camera.update"
  | "camera.check"
  | "camera.snapshot"
  | "camera.event"
  | "camera.disabled"
  | "camera.delete"
  | "telegram.sync"
  | "export.generate"
  | "tool.qr"
  | "chain.create"
  | "chain.revoke"
  | "chain.reports.delete"
  | "chain.report"
  | "preview.start";

export interface AuditInput {
  userId?: string | null;
  actor?: string;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Append-only audit trail. Every state-changing action in Hamsa goes through
 * here — it is the backbone of the "authorized use" story this product sells.
 *
 * Never throws into the request path: a failed audit write is logged loudly and
 * the caller continues, because losing the audit row is bad but dropping a
 * legitimate investigation result is worse.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await run(
      `INSERT INTO audit_log (id, user_id, actor, action, entity, entity_id, meta, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      input.userId ?? null,
      input.actor ?? "system",
      input.action,
      input.entity ?? null,
      input.entityId ?? null,
      input.meta ? JSON.stringify(input.meta).slice(0, 8000) : null,
      input.ip ?? null,
      (input.userAgent ?? "").slice(0, 400),
      now(),
    );
  } catch (err) {
    console.error("[audit] failed to write entry", err);
  }
}
