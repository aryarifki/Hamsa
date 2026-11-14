import { randomBytes } from "node:crypto";
import { all, newId, now, one, run, tx } from "./db";
import { audit } from "./audit";
import { balanceOf } from "./tokens";
import { qrSvg } from "./qr-encode";

/**
 * Prepaid token top-ups.
 *
 * Phone-X sells token packs through QRIS and USDT. Hamsa keeps the same plans
 * and the same two-step shape (create → settle), but the payment rail is the
 * operator's: no card data, no custody, and no invented merchant identifiers.
 *
 *  - QRIS: a dynamic EMVCo payload is only produced when the operator supplies
 *    a merchant base string (`HAMSA_QRIS_MERCHANT_PAYLOAD`). Without it the
 *    top-up still exists and says exactly what is missing.
 *  - USDT: the deposit address comes from `HAMSA_USDT_ADDRESS`; the network from
 *    `HAMSA_USDT_NETWORK` (default TRC20).
 *  - Settlement happens through an admin action or a signed webhook. Both paths
 *    go through `settleTopup`, which flips the row exactly once, so a retried
 *    webhook can never credit twice.
 */

export type TopupProvider = "qris" | "usdt";
export type TopupStatus = "pending" | "paid" | "expired" | "cancelled";

export interface TopupPlan {
  id: string;
  provider: TopupProvider;
  tokens: number;
  /** IDR price for QRIS plans. */
  amountIdr: number | null;
  /** USD price for USDT plans. */
  amountUsd: number | null;
  label: string;
}

export const PLANS: TopupPlan[] = [
  { id: "qris-10", provider: "qris", tokens: 10, amountIdr: 40_000, amountUsd: null, label: "10 tokens · Rp 40.000" },
  { id: "qris-20", provider: "qris", tokens: 20, amountIdr: 80_000, amountUsd: null, label: "20 tokens · Rp 80.000" },
  { id: "qris-50", provider: "qris", tokens: 50, amountIdr: 200_000, amountUsd: null, label: "50 tokens · Rp 200.000" },
  { id: "qris-100", provider: "qris", tokens: 100, amountIdr: 400_000, amountUsd: null, label: "100 tokens · Rp 400.000" },
  { id: "qris-200", provider: "qris", tokens: 200, amountIdr: 800_000, amountUsd: null, label: "200 tokens · Rp 800.000" },
  { id: "qris-300", provider: "qris", tokens: 300, amountIdr: 1_200_000, amountUsd: null, label: "300 tokens · Rp 1.200.000" },
  { id: "usdt-50", provider: "usdt", tokens: 50, amountIdr: null, amountUsd: 12.5, label: "50 tokens · $12.50" },
  { id: "usdt-100", provider: "usdt", tokens: 100, amountIdr: null, amountUsd: 25, label: "100 tokens · $25.00" },
  { id: "usdt-200", provider: "usdt", tokens: 200, amountIdr: null, amountUsd: 50, label: "200 tokens · $50.00" },
  { id: "usdt-300", provider: "usdt", tokens: 300, amountIdr: null, amountUsd: 75, label: "300 tokens · $75.00" },
];

/** A top-up is payable for 30 minutes, matching the QRIS session window. */
export const TOPUP_TTL_MS = 30 * 60_000;

export class TopupError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, message: string, code = "TOPUP_ERROR", extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export interface Topup {
  id: string;
  user_id: string;
  provider: TopupProvider;
  tokens: number;
  amount_idr: number | null;
  amount_usd: string | number | null;
  status: TopupStatus;
  reference: string;
  qr_payload: string | null;
  pay_address: string | null;
  created_at: string;
  expires_at: string | null;
  paid_at: string | null;
  settled_by: string | null;
}

export function planById(id: string): TopupPlan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function reference(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `HX-${out}`;
}

/**
 * Dynamic QRIS is an EMVCo TLV with a CRC16 trailer. Rather than guess a
 * merchant template, the operator supplies the static payload and the amount and
 * reference are appended as tag 54 (amount) / 62-05 (reference). When no
 * payload is configured the field stays null — a QR that decodes to nothing
 * would be worse than an explicit "not configured".
 */
function qrisPayload(amountIdr: number, ref: string): string | null {
  const base = process.env.HAMSA_QRIS_MERCHANT_PAYLOAD?.trim();
  if (!base) return null;

  const tlv = (tag: string, value: string): string => `${tag}${String(value.length).padStart(2, "0")}${value}`;

  // Strip an existing CRC (tag 63) and the amount (54) before re-encoding.
  let working = base;
  const crcIndex = working.lastIndexOf("6304");
  if (crcIndex !== -1) working = working.slice(0, crcIndex);
  working = working.replace(/54\d{2}\d+/, "");

  const withAmount = `${working}${tlv("54", String(Math.round(amountIdr)))}${tlv("62", tlv("05", ref))}`;
  const toCrc = `${withAmount}6304`;
  return `${toCrc}${crc16ccitt(toCrc)}`;
}

function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export interface TopupInstructions {
  provider: TopupProvider;
  reference: string;
  tokens: number;
  amountIdr: number | null;
  amountUsd: number | null;
  qrPayload: string | null;
  /** Inline SVG for `qrPayload`, or null when no payload exists. */
  qrSvg: string | null;
  payAddress: string | null;
  network: string | null;
  expiresAt: string;
  warnings: string[];
}

export interface CreateTopupResult {
  topup: Topup;
  instructions: TopupInstructions;
}

/**
 * Creates a pending top-up. Multiple pending rows are allowed on purpose: an
 * analyst may open a QRIS and a USDT session at once, and only the one that is
 * actually paid gets settled.
 */
export async function createTopup(
  userId: string,
  planId: string,
  meta: { ip?: string | null } = {},
): Promise<CreateTopupResult> {
  const plan = planById(planId);
  if (!plan) throw new TopupError(400, "Unknown plan", "PLAN_NOT_FOUND", { plans: PLANS.map((p) => p.id) });

  const created = now();
  const expiresAt = new Date(Date.now() + TOPUP_TTL_MS).toISOString();
  const ref = reference();
  const id = newId();
  const warnings: string[] = [];

  let qr: string | null = null;
  let address: string | null = null;
  let network: string | null = null;

  if (plan.provider === "qris") {
    qr = qrisPayload(plan.amountIdr ?? 0, ref);
    if (!qr) {
      warnings.push(
        "QRIS merchant payload is not configured. Set HAMSA_QRIS_MERCHANT_PAYLOAD to a static EMVCo payload from your PJSP; the reference can be quoted in a manual transfer until then.",
      );
    }
  } else {
    address = process.env.HAMSA_USDT_ADDRESS?.trim() || null;
    network = process.env.HAMSA_USDT_NETWORK?.trim() || "TRC20";
    if (!address) {
      warnings.push(
        "USDT deposit address is not configured. Set HAMSA_USDT_ADDRESS (and optionally HAMSA_USDT_NETWORK) before offering this plan.",
      );
    }
  }

  await run(
    `INSERT INTO topups (id, user_id, provider, tokens, amount_idr, amount_usd, status, reference, qr_payload, pay_address,
                         created_at, expires_at, paid_at, settled_by)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, NULL, NULL)`,
    id,
    userId,
    plan.provider,
    plan.tokens,
    plan.amountIdr,
    plan.amountUsd,
    ref,
    qr,
    address,
    created,
    expiresAt,
  );

  await audit({
    userId,
    actor: userId,
    action: "billing.topup",
    entity: "topup",
    entityId: id,
    meta: { plan: plan.id, provider: plan.provider, tokens: plan.tokens, ip: meta.ip ?? null },
  });

  const topup = (await one<Topup>("SELECT * FROM topups WHERE id = ?", id))!;

  return {
    topup,
    instructions: {
      provider: plan.provider,
      reference: ref,
      tokens: plan.tokens,
      amountIdr: plan.amountIdr,
      amountUsd: plan.amountUsd,
      qrPayload: qr,
      qrSvg: qr ? qrSvg(qr) : null,
      payAddress: address,
      network,
      expiresAt,
      warnings,
    },
  };
}

export async function listTopups(userId: string, limit = 25): Promise<Topup[]> {
  return all<Topup>(
    "SELECT * FROM topups WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    userId,
    Math.min(Math.max(limit, 1), 200),
  );
}

export async function topupByReference(ref: string): Promise<Topup | undefined> {
  return one<Topup>("SELECT * FROM topups WHERE reference = ?", ref.trim().toUpperCase());
}

/** Lazily expires a pending row so the UI never shows a stale QR as payable. */
export async function expireIfStale(topup: Topup): Promise<Topup> {
  if (topup.status !== "pending") return topup;
  if (!topup.expires_at || Date.parse(topup.expires_at) > Date.now()) return topup;
  await run("UPDATE topups SET status = 'expired' WHERE id = ? AND status = 'pending'", topup.id);
  return { ...topup, status: "expired" };
}

export interface SettleResult {
  topup: Topup;
  alreadySettled: boolean;
  balance: number;
}

/**
 * Marks a pending top-up paid and grants its tokens in one transaction.
 *
 * The status guard is part of the UPDATE, so two concurrent callers (admin and
 * webhook, or a retried webhook) produce exactly one credit. `amountSeen` is
 * recorded only for the audit trail — a mismatch is reported to the caller so a
 * human can decide, but it never silently changes the granted amount.
 */
export async function settleTopup(
  ref: string,
  opts: { settledBy: string; amountSeen?: string | null } = { settledBy: "system" },
): Promise<SettleResult> {
  const normalized = ref.trim().toUpperCase();

  // Expiry is committed outside the settlement transaction: a rollback inside
  // the tx would also undo the status flip, leaving a stale "pending" row.
  const pre = await topupByReference(normalized);
  if (!pre) throw new TopupError(404, "Top-up not found", "TOPUP_NOT_FOUND");
  const current = await expireIfStale(pre);
  if (current.status === "cancelled") throw new TopupError(409, "Top-up was cancelled", "TOPUP_CANCELLED");
  if (current.status === "expired") {
    throw new TopupError(410, "Top-up has expired — create a new one", "TOPUP_EXPIRED");
  }

  return tx(async (db) => {
    const row = await db.one<Topup>("SELECT * FROM topups WHERE reference = ?", normalized);
    if (!row) throw new TopupError(404, "Top-up not found", "TOPUP_NOT_FOUND");

    if (row.status === "paid") {
      const balance = await db.one<{ credits: number }>("SELECT credits FROM users WHERE id = ?", row.user_id);
      return { topup: row, alreadySettled: true, balance: balance?.credits ?? 0 };
    }

    if (row.status === "cancelled") throw new TopupError(409, "Top-up was cancelled", "TOPUP_CANCELLED");
    if (row.status === "expired") {
      throw new TopupError(410, "Top-up has expired — create a new one", "TOPUP_EXPIRED");
    }

    const updated = await db.run(
      "UPDATE topups SET status = 'paid', paid_at = ?, settled_by = ? WHERE id = ? AND status = 'pending'",
      now(),
      opts.settledBy,
      row.id,
    );
    if (updated.changes === 0) {
      // Someone else settled between our read and write; re-read for the truth.
      const current = await db.one<Topup>("SELECT * FROM topups WHERE id = ?", row.id);
      const balance = await db.one<{ credits: number }>("SELECT credits FROM users WHERE id = ?", row.user_id);
      return { topup: current!, alreadySettled: current?.status === "paid", balance: balance?.credits ?? 0 };
    }

    await db.run("UPDATE users SET credits = credits + ? WHERE id = ?", row.tokens, row.user_id);
    const balance = await db.one<{ credits: number }>("SELECT credits FROM users WHERE id = ?", row.user_id);
    await db.run(
      `INSERT INTO ledger (id, user_id, delta, balance_after, reason, ref_type, ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'topup', ?, ?)`,
      newId(),
      row.user_id,
      row.tokens,
      balance?.credits ?? 0,
      `topup:${row.provider}`,
      row.id,
      now(),
    );

    const paid = (await db.one<Topup>("SELECT * FROM topups WHERE id = ?", row.id))!;
    return { topup: paid, alreadySettled: false, balance: balance?.credits ?? 0 };
  });
}

export async function cancelTopup(userId: string, ref: string): Promise<Topup> {
  const row = await topupByReference(ref);
  if (!row) throw new TopupError(404, "Top-up not found", "TOPUP_NOT_FOUND");
  if (row.user_id !== userId) throw new TopupError(404, "Top-up not found", "TOPUP_NOT_FOUND");
  if (row.status !== "pending") throw new TopupError(409, `Top-up is already ${row.status}`, "TOPUP_NOT_PENDING");
  await run("UPDATE topups SET status = 'cancelled' WHERE id = ? AND status = 'pending'", row.id);
  return (await one<Topup>("SELECT * FROM topups WHERE id = ?", row.id))!;
}

export interface BalanceSnapshot {
  balance: number;
  pendingTopups: number;
  lastPaidAt: string | null;
}

export async function balanceSnapshot(userId: string): Promise<BalanceSnapshot> {
  const balance = await balanceOf(userId);
  const pending = await one<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM topups WHERE user_id = ? AND status = 'pending'",
    userId,
  );
  const last = await one<{ paid_at: string | null }>(
    "SELECT MAX(paid_at) AS paid_at FROM topups WHERE user_id = ? AND status = 'paid'",
    userId,
  );
  return { balance, pendingTopups: pending?.count ?? 0, lastPaidAt: last?.paid_at ?? null };
}

export function publicTopup(row: Topup): Omit<Topup, "user_id" | "settled_by"> {
  const { user_id: _userId, settled_by: _settledBy, ...rest } = row;
  return rest;
}
