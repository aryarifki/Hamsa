import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Icon } from "@/components/Icon";
import { addWatchAction, removeWatchAction } from "@/app/(console)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchlist" };

interface Watch {
  id: string;
  module: string;
  target: string;
  interval_hours: number;
  active: number;
  last_run_at: string | null;
  last_status: string | null;
  last_result: string | null;
  latest_lookup: string | null;
}

export default async function WatchlistPage() {
  const user = await requireUser();
  const rows = all<Watch>(
    `SELECT w.*,
            (SELECT json_extract(w.last_result, '$.lookupId')) AS latest_lookup
     FROM watchlist w WHERE w.user_id = ? ORDER BY w.created_at DESC`,
    user.id,
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Continuous monitoring</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            Re-run a lookup on a schedule and diff the results. Runs are charged to your balance.
          </p>
        </div>
        <span className="badge mono">{rows.filter((r) => r.active).length} active</span>
      </header>

      <section className="card card-pad">
        <h2 className="text-[13px] font-semibold">Add a target</h2>
        <form action={addWatchAction} className="mt-3 grid gap-3 sm:grid-cols-[150px_1fr_130px_auto]">
          <select name="module" className="select" defaultValue="phone">
            <option value="phone">Phone</option>
            <option value="ip">IP address</option>
            <option value="email">Email</option>
            <option value="username">Username</option>
            <option value="telegram">Telegram</option>
          </select>
          <input name="target" className="input mono" placeholder="Target value" required />
          <select name="interval_hours" className="select" defaultValue="24">
            <option value="6">Every 6h</option>
            <option value="12">Every 12h</option>
            <option value="24">Every 24h</option>
            <option value="72">Every 3 days</option>
            <option value="168">Weekly</option>
          </select>
          <button type="submit" className="btn btn-primary">
            <Icon name="plus" size={13} /> Add
          </button>
        </form>
      </section>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-[12.5px] text-faint">
            Nothing monitored yet. Add a target above to start a schedule.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Target</th>
                  <th>Interval</th>
                  <th>Last run</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-[12px] text-muted">{r.module}</td>
                    <td className="mono max-w-[260px] truncate text-[12px]">{r.target}</td>
                    <td className="mono text-[12px] text-muted">{r.interval_hours}h</td>
                    <td className="whitespace-nowrap text-[11.5px] text-faint">
                      {r.last_run_at ? new Date(r.last_run_at).toLocaleString() : "never"}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          r.last_status === "ok"
                            ? "badge-good"
                            : r.last_status
                              ? "badge-warn"
                              : ""
                        }`}
                      >
                        {r.last_status ?? "pending"}
                      </span>
                    </td>
                    <td className="text-right">
                      <form action={removeWatchAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" className="btn btn-ghost px-2 py-1 text-[11px]">
                          <Icon name="trash" size={12} /> Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card card-pad">
        <h2 className="text-[13px] font-semibold">Scheduler</h2>
        <p className="mt-1 text-[12px] text-muted">
          Hamsa does not run a background daemon. Point any scheduler at the authenticated endpoint:
        </p>
        <pre className="mono mt-3 overflow-x-auto rounded-lg border border-line bg-ink p-3.5 text-[11.5px] leading-relaxed text-muted">
{`# crontab -e  — every 15 minutes
*/15 * * * * curl -s -X POST https://your-host/api/v1/cron/watchlist \\
  -H "x-cron-secret: $CRON_SECRET"`}
        </pre>
        <p className="mt-2 text-[11px] text-faint">
          Set <span className="mono">CRON_SECRET</span> in the environment. Up to 10 due entries run
          per invocation; owners without credits are skipped, never overdrawn.
        </p>
      </div>
    </div>
  );
}
