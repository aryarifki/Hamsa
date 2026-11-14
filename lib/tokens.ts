import { newId, now, one, run, tx, type Db } from "./db";

export class InsufficientCreditsError extends Error {
  readonly required: number;
  readonly balance: number;

  constructor(required: number, balance: number) {
    super("Insufficient credits");
    this.required = required;
    this.balance = balance;
  }
}

export type { ModuleKey } from "./intel/types";
import type { ModuleKey } from "./intel/types";

const COST_ENV: Record<ModuleKey, string> = {
  phone: "HAMSA_COST_PHONE",
  ip: "HAMSA_COST_IP",
  email: "HAMSA_COST_EMAIL",
  username: "HAMSA_COST_USERNAME",
  telegram: "HAMSA_COST_TELEGRAM",
  hlr: "HAMSA_COST_HLR",
  whatsapp: "HAMSA_COST_WHATSAPP",
  getcontact: "HAMSA_COST_GETCONTACT",
  ewallet: "HAMSA_COST_EWALLET",
  breach: "HAMSA_COST_BREACH",
  humint: "HAMSA_COST_HUMINT",
  "public-evidence": "HAMSA_COST_PUBLIC_EVIDENCE",
  name: "HAMSA_COST_NAME",
  domain: "HAMSA_COST_DOMAIN",
  "telegram-analytics": "HAMSA_COST_TELEGRAM_ANALYTICS",
};

const DEFAULT_COST: Record<ModuleKey, number> = {
  phone: 2,
  ip: 2,
  email: 3,
  username: 3,
  telegram: 4,
  hlr: 4,
  whatsapp: 4,
  getcontact: 4,
  ewallet: 4,
  breach: 4,
  humint: 8,
  "public-evidence": 4,
  name: 4,
  domain: 4,
  "telegram-analytics": 8,
};

export function costOf(module: ModuleKey): number {
  const raw = Number(process.env[COST_ENV[module]] ?? DEFAULT_COST[module]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_COST[module];
}

async function readBalance(db: Db, userId: string): Promise<number> {
  const row = await db.one<{ credits: number }>("SELECT credits FROM users WHERE id = ?", userId);
  return row?.credits ?? 0;
}

export async function balanceOf(userId: string): Promise<number> {
  const row = await one<{ credits: number }>("SELECT credits FROM users WHERE id = ?", userId);
  return row?.credits ?? 0;
}

/**
 * Atomically debits credits and writes the ledger entry. The balance guard is
 * part of the UPDATE statement, so two concurrent lookups can never both
 * succeed against a single remaining credit. The ledger insert shares the
 * transaction with the debit.
 */
export async function charge(
  userId: string,
  amount: number,
  reason: string,
  refType?: string,
  refId?: string,
): Promise<number> {
  if (amount <= 0) return balanceOf(userId);

  return tx(async (db) => {
    const res = await db.run(
      "UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?",
      amount,
      userId,
      amount,
    );
    if (res.changes === 0) {
      throw new InsufficientCreditsError(amount, await readBalance(db, userId));
    }
    const balance = await readBalance(db, userId);
    await db.run(
      `INSERT INTO ledger (id, user_id, delta, balance_after, reason, ref_type, ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      userId,
      -amount,
      balance,
      reason,
      refType ?? null,
      refId ?? null,
      now(),
    );
    return balance;
  });
}

/** Refunds a charge when the underlying provider call failed. */
export function refund(userId: string, amount: number, reason: string, refId?: string): Promise<number> {
  return grant(userId, amount, `refund:${reason}`, "lookup", refId);
}

export async function grant(
  userId: string,
  amount: number,
  reason: string,
  refType?: string,
  refId?: string,
): Promise<number> {
  return tx(async (db) => {
    await db.run("UPDATE users SET credits = credits + ? WHERE id = ?", amount, userId);
    const balance = await readBalance(db, userId);
    await db.run(
      `INSERT INTO ledger (id, user_id, delta, balance_after, reason, ref_type, ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      userId,
      amount,
      balance,
      reason,
      refType ?? null,
      refId ?? null,
      now(),
    );
    return balance;
  });
}

export interface LedgerEntry {
  id: string;
  delta: number;
  balance_after: number;
  reason: string;
  created_at: string;
}

export async function ledgerFor(userId: string, limit = 50): Promise<LedgerEntry[]> {
  return (await import("./db")).all<LedgerEntry>(
    `SELECT id, delta, balance_after, reason, created_at
     FROM ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId,
    limit,
  );
}
