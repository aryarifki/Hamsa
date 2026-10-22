import { newId, now, run } from "./db";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
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
  | "device.ping"
  | "device.delete"
  | "geofence.create"
  | "geofence.delete"
  | "cctv.create"
  | "cctv.check"
  | "cctv.delete"
  | "telegram.sync"
  | "export.generate";

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
 */
export function audit(input: AuditInput): void {
  try {
    run(
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
    // Auditing must never break the request path, but it must be visible.
    console.error("[audit] failed to write entry", err);
  }
}
