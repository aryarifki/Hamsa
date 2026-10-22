import { all, newId, now, one, run, tx } from "./db";

export class InsufficientCreditsError extends Error {
  readonly required: number;
  readonly balance: number;

  constructor(required: number, balance: number) {
    super("Insufficient credits");
    this.required = required;
    this.balance = balance;
  }
}

export type ModuleKey = "phone" | "ip" | "email" | "username" | "telegram";

const COST_ENV: Record<ModuleKey, string> = {
  phone: "HAMSA_COST_PHONE",
  ip: "HAMSA_COST_IP",
  email: "HAMSA_COST_EMAIL",
  username: "HAMSA_COST_USERNAME",
  telegram: "HAMSA_COST_TELEGRAM",
};

const DEFAULT_COST: Record<ModuleKey, number> = {
  phone: 2,
  ip: 2,
  email: 3,
  username: 3,
  telegram: 4,
};

export function costOf(module: ModuleKey): number {
  const raw = Number(process.env[COST_ENV[module]] ?? DEFAULT_COST[module]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_COST[module];
}

export function balanceOf(userId: string): number {
  return one<{ credits: number }>("SELECT credits FROM users WHERE id = ?", userId)?.credits ?? 0;
}

/**
 * Atomically debits credits and writes the ledger entry. The balance guard is
 * part of the UPDATE statement, so two concurrent lookups can never both
 * succeed against a single remaining credit.
 */
export function charge(
  userId: string,
  amount: number,
  reason: string,
  refType?: string,
  refId?: string,
): number {
  return tx(() => {
    if (amount <= 0) {
      return balanceOf(userId);
    }
    const res = run(
      "UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?",
      amount,
      userId,
      amount,
    );
    if (res.changes === 0) {
      throw new InsufficientCreditsError(amount, balanceOf(userId));
    }
    const balance = balanceOf(userId);
    run(
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
export function refund(userId: string, amount: number, reason: string, refId?: string): number {
  return grant(userId, amount, `refund:${reason}`, "lookup", refId);
}

export function grant(
  userId: string,
  amount: number,
  reason: string,
  refType?: string,
  refId?: string,
): number {
  return tx(() => {
    run("UPDATE users SET credits = credits + ? WHERE id = ?", amount, userId);
    const balance = balanceOf(userId);
    run(
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

export function ledgerFor(userId: string, limit = 50): LedgerEntry[] {
  return all<LedgerEntry>(
    `SELECT id, delta, balance_after, reason, created_at
     FROM ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId,
    limit,
  );
}
