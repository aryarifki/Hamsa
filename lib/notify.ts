import { all, newId, now, one, run } from "./db";

/**
 * The notification channel both new modules use: a camera that locks itself
 * after an authentication failure, and a device owner whose kit crosses a
 * geofence boundary.
 *
 * Deliberately in-app only. Nothing is emailed or pushed to a third party, so
 * location context never leaves the deployment by accident.
 */

export interface NotificationInput {
  kind: string;
  title: string;
  body?: string;
  entity?: string;
  entityId?: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  entity: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export async function notify(userId: string, input: NotificationInput): Promise<void> {
  await run(
    `INSERT INTO notifications (id, user_id, kind, title, body, entity, entity_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    userId,
    input.kind,
    input.title.slice(0, 200),
    input.body?.slice(0, 2000) ?? null,
    input.entity ?? null,
    input.entityId ?? null,
    now(),
  );
}

/** Fans out to every active administrator. Used for fail-closed camera alerts. */
export async function notifyAdmins(input: NotificationInput): Promise<number> {
  const admins = await all<{ id: string }>(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active'",
  );
  for (const admin of admins) await notify(admin.id, input);
  return admins.length;
}

export async function listNotifications(userId: string, limit = 50): Promise<NotificationRow[]> {
  return all<NotificationRow>(
    `SELECT id, user_id, kind, title, body, entity, entity_id, read_at, created_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId,
    limit,
  );
}

export async function unreadCount(userId: string): Promise<number> {
  const row = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND read_at IS NULL",
    userId,
  );
  return row?.n ?? 0;
}

export async function markAllRead(userId: string): Promise<void> {
  await run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", now(), userId);
}

export async function markRead(id: string, userId: string): Promise<void> {
  await run("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL", now(), id, userId);
}
