import { all, now, run } from "./db";
import { userById } from "./users";
import { runLookup } from "./lookup";
import { costOf, InsufficientCreditsError } from "./tokens";
import type { ModuleKey } from "./tokens";

export interface WatchRow {
  id: string;
  user_id: string;
  module: ModuleKey;
  target: string;
  interval_hours: number;
  active: number;
  last_run_at: string | null;
  last_status: string | null;
  last_result: string | null;
  created_at: string;
}

export interface WatchRunSummary {
  checked: number;
  skipped: number;
  errors: number;
  results: Array<{ id: string; target: string; status: string }>;
}

/**
 * Executes every watchlist entry whose interval has elapsed.
 *
 * Deliberately synchronous and bounded: a cron request never tries to drain an
 * unbounded queue. Credits are charged to the entry's owner, and an owner who
 * cannot pay is skipped rather than allowed to run up a negative balance.
 */
export async function runDueWatchlist(maxItems = 10): Promise<WatchRunSummary> {
  const due = all<WatchRow>(
    `SELECT * FROM watchlist
     WHERE active = 1
       AND (last_run_at IS NULL OR datetime(last_run_at, '+' || interval_hours || ' hours') <= datetime('now'))
     ORDER BY COALESCE(last_run_at, '1970-01-01') ASC
     LIMIT ?`,
    maxItems,
  );

  const summary: WatchRunSummary = { checked: 0, skipped: 0, errors: 0, results: [] };

  for (const entry of due) {
    const owner = userById(entry.user_id);
    if (!owner || owner.credits < costOf(entry.module)) {
      summary.skipped += 1;
      run(
        "UPDATE watchlist SET last_run_at = ?, last_status = 'skipped:credits' WHERE id = ?",
        now(),
        entry.id,
      );
      summary.results.push({ id: entry.id, target: entry.target, status: "skipped" });
      continue;
    }

    try {
      const out = await runLookup({
        user: owner,
        module: entry.module,
        target: entry.target,
        ip: "cron",
        userAgent: "hamsa-watchlist/1.0",
      });
      summary.checked += 1;
      run(
        "UPDATE watchlist SET last_run_at = ?, last_status = 'ok', last_result = ? WHERE id = ?",
        now(),
        JSON.stringify({
          lookupId: out.id,
          signals: out.result.signals,
          at: now(),
        }),
        entry.id,
      );
      summary.results.push({ id: entry.id, target: entry.target, status: "ok" });
    } catch (err) {
      summary.errors += 1;
      const status =
        err instanceof InsufficientCreditsError ? "skipped:credits" : `error:${(err as Error).message.slice(0, 120)}`;
      run("UPDATE watchlist SET last_run_at = ?, last_status = ? WHERE id = ?", now(), status, entry.id);
      summary.results.push({ id: entry.id, target: entry.target, status });
    }
  }

  return summary;
}
