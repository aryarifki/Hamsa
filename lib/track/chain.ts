import { randomBytes } from "node:crypto";
import { all, newId, now, one, run } from "../db";
import { audit } from "../audit";
import { validLatLng } from "../intel/geo";
import type { User } from "../users";

/**
 * Shareable geofence chains ("Tango").
 *
 * A chain is a capability URL: whoever holds `/t/<code>` can submit their
 * position, which is exactly how Phone-X's chain works and exactly why the code
 * is random, single-purpose and revocable. Reports are write-only from the
 * public page; reading them requires the owning account.
 */

export interface Chain {
  id: string;
  code: string;
  user_id: string;
  label: string;
  active: number;
  views: number;
  created_at: string;
  expires_at: string | null;
}

export interface ChainReport {
  id: string;
  chain_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  note: string | null;
  ip: string | null;
  user_agent: string | null;
  at: string;
}

export class ChainError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "CHAIN_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function chainCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export async function createChain(
  user: User,
  input: { label?: string; ttlHours?: number } = {},
): Promise<Chain> {
  const label = (input.label ?? "Tango chain").trim().slice(0, 120) || "Tango chain";
  const ttl = Math.max(1, Math.min(24 * 30, Math.round(input.ttlHours ?? 72)));
  const expiresAt = new Date(Date.now() + ttl * 3_600_000).toISOString();

  // Collisions are vanishingly unlikely (32^8) but a UNIQUE violation must be a
  // retry, not a 500.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = chainCode();
    const id = newId();
    try {
      await run(
        `INSERT INTO geofence_chains (id, code, user_id, label, active, views, created_at, expires_at)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?)`,
        id,
        code,
        user.id,
        label,
        now(),
        expiresAt,
      );
      await audit({
        userId: user.id,
        actor: user.email,
        action: "chain.create",
        entity: "geofence_chain",
        entityId: id,
        meta: { label, expiresAt },
      });
      return (await one<Chain>("SELECT * FROM geofence_chains WHERE id = ?", id))!;
    } catch (err) {
      if (/duplicate key|unique/i.test((err as Error).message)) continue;
      throw err;
    }
  }
  throw new ChainError(500, "Could not allocate a chain code");
}

export async function listChains(user: User): Promise<Array<Chain & { report_count: number; last_report_at: string | null }>> {
  const scope = user.role === "admin" ? "" : "WHERE c.user_id = ?";
  return all(
    `SELECT c.*,
            COUNT(r.id)::int AS report_count,
            MAX(r.at) AS last_report_at
       FROM geofence_chains c
       LEFT JOIN geofence_reports r ON r.chain_id = c.id
       ${scope}
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
    ...(user.role === "admin" ? [] : [user.id]),
  );
}

export async function chainByCode(code: string): Promise<Chain | undefined> {
  return one<Chain>("SELECT * FROM geofence_chains WHERE code = ?", code.trim().toUpperCase());
}

export async function chainForUser(id: string, user: User): Promise<Chain | undefined> {
  const chain = await one<Chain>("SELECT * FROM geofence_chains WHERE id = ?", id);
  if (!chain) return undefined;
  if (user.role !== "admin" && chain.user_id !== user.id) return undefined;
  return chain;
}

/** A chain is usable while active and before its expiry. */
export function chainOpen(chain: Chain, nowMs = Date.now()): boolean {
  if (!chain.active) return false;
  if (chain.expires_at && Date.parse(chain.expires_at) <= nowMs) return false;
  return true;
}

export async function touchChain(id: string): Promise<void> {
  await run("UPDATE geofence_chains SET views = views + 1 WHERE id = ?", id);
}

export interface ReportInput {
  lat: number;
  lng: number;
  accuracy?: number | null;
  note?: string | null;
}

export async function addReport(
  code: string,
  input: ReportInput,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ chain: Chain; report: ChainReport }> {
  const chain = await chainByCode(code);
  if (!chain) throw new ChainError(404, "Chain not found", "CHAIN_NOT_FOUND");
  if (!chainOpen(chain)) throw new ChainError(410, "Chain is closed or expired", "CHAIN_CLOSED");
  if (!validLatLng(input.lat, input.lng)) throw new ChainError(400, "Invalid coordinates");

  const id = newId();
  await run(
    `INSERT INTO geofence_reports (id, chain_id, lat, lng, accuracy, note, ip, user_agent, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    chain.id,
    input.lat,
    input.lng,
    input.accuracy ?? null,
    (input.note ?? "").slice(0, 500) || null,
    meta.ip ?? null,
    (meta.userAgent ?? "").slice(0, 300) || null,
    now(),
  );

  return {
    chain,
    report: (await one<ChainReport>("SELECT * FROM geofence_reports WHERE id = ?", id))!,
  };
}

export async function listReports(chainId: string, user: User, limit = 200): Promise<ChainReport[]> {
  const chain = await chainForUser(chainId, user);
  if (!chain) throw new ChainError(404, "Chain not found", "CHAIN_NOT_FOUND");
  return all<ChainReport>(
    "SELECT * FROM geofence_reports WHERE chain_id = ? ORDER BY at DESC LIMIT ?",
    chainId,
    Math.min(Math.max(limit, 1), 1000),
  );
}

export async function deleteReports(chainId: string, user: User): Promise<number> {
  const chain = await chainForUser(chainId, user);
  if (!chain) throw new ChainError(404, "Chain not found", "CHAIN_NOT_FOUND");
  const rows = await all<{ id: string }>("SELECT id FROM geofence_reports WHERE chain_id = ?", chainId);
  await run("DELETE FROM geofence_reports WHERE chain_id = ?", chainId);
  await audit({
    userId: user.id,
    actor: user.email,
    action: "chain.reports.delete",
    entity: "geofence_chain",
    entityId: chainId,
    meta: { removed: rows.length },
  });
  return rows.length;
}

export async function revokeChain(chainId: string, user: User): Promise<void> {
  const chain = await chainForUser(chainId, user);
  if (!chain) throw new ChainError(404, "Chain not found", "CHAIN_NOT_FOUND");
  await run("UPDATE geofence_chains SET active = 0 WHERE id = ?", chainId);
  await audit({
    userId: user.id,
    actor: user.email,
    action: "chain.revoke",
    entity: "geofence_chain",
    entityId: chainId,
    meta: { label: chain.label },
  });
}

export interface ChainStats {
  chain: Chain;
  reports: number;
  uniqueDays: number;
  firstAt: string | null;
  lastAt: string | null;
  spreadM: number;
}

/** Summary numbers for the console table; nothing is fetched from outside. */
export async function chainStats(chainId: string, user: User): Promise<ChainStats> {
  const chain = await chainForUser(chainId, user);
  if (!chain) throw new ChainError(404, "Chain not found", "CHAIN_NOT_FOUND");

  const reports = await all<ChainReport>(
    "SELECT * FROM geofence_reports WHERE chain_id = ? ORDER BY at ASC",
    chainId,
  );

  const days = new Set(reports.map((r) => r.at.slice(0, 10)));
  let spread = 0;
  if (reports.length > 1) {
    const lats = reports.map((r) => r.lat);
    const lngs = reports.map((r) => r.lng);
    const dLat = (Math.max(...lats) - Math.min(...lats)) * 111_320;
    const dLng = (Math.max(...lngs) - Math.min(...lngs)) * 111_320 * Math.cos((reports[0].lat * Math.PI) / 180);
    spread = Math.round(Math.hypot(dLat, dLng));
  }

  return {
    chain,
    reports: reports.length,
    uniqueDays: days.size,
    firstAt: reports[0]?.at ?? null,
    lastAt: reports.at(-1)?.at ?? null,
    spreadM: spread,
  };
}
