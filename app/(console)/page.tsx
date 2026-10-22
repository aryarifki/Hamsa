import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { Icon, type IconName } from "@/components/Icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

interface CountRow {
  n: number;
}

const MODULES: Array<{ key: string; label: string; icon: IconName; href: string }> = [
  { key: "phone", label: "Phone", icon: "phone", href: "/lookup/phone" },
  { key: "ip", label: "IP address", icon: "globe", href: "/lookup/ip" },
  { key: "email", label: "Email", icon: "mail", href: "/lookup/email" },
  { key: "username", label: "Username", icon: "at", href: "/lookup/username" },
  { key: "telegram", label: "Telegram", icon: "send", href: "/lookup/telegram" },
];

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 220;
  const h = 48;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 6) - 3).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d9b26a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#d9b26a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${points.join(" ")} ${w},${h}`} fill="url(#spark)" />
      <polyline points={points.join(" ")} fill="none" stroke="#d9b26a" strokeWidth="1.4" />
    </svg>
  );
}

function Stat({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: IconName;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        <Icon name={icon} size={13} className="text-faint" />
      </div>
      <p className="mono mt-2 text-[24px] font-semibold leading-none">{value}</p>
      {sub && <p className="mt-1.5 text-[11px] text-faint">{sub}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const since = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);

  const totals = one<{ total: number; today: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today
     FROM lookups WHERE user_id = ?`,
    new Date().toISOString().slice(0, 10),
    user.id,
  ) ?? { total: 0, today: 0 };

  const openCases = one<CountRow>("SELECT COUNT(*) AS n FROM cases WHERE user_id = ? AND status = 'open'", user.id)?.n ?? 0;
  const watching = one<CountRow>("SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ? AND active = 1", user.id)?.n ?? 0;

  const byModule = all<{ module: string; n: number }>(
    "SELECT module, COUNT(*) AS n FROM lookups WHERE user_id = ? GROUP BY module",
    user.id,
  );
  const moduleCount = new Map(byModule.map((r) => [r.module, r.n]));

  const daily = all<{ d: string; n: number }>(
    "SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n FROM lookups WHERE user_id = ? AND created_at >= ? GROUP BY d",
    user.id,
    since,
  );
  const dailyMap = new Map(daily.map((r) => [r.d, r.n]));
  const series = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
    return dailyMap.get(d) ?? 0;
  });

  const recent = all<{ id: string; module: string; target: string; status: string; created_at: string; cost: number }>(
    "SELECT id, module, target, status, created_at, cost FROM lookups WHERE user_id = ? ORDER BY created_at DESC LIMIT 7",
    user.id,
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 rise">
        <div>
          <p className="eyebrow">{greeting}</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-tight">{user.name}</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            {totals.today} lookup{totals.today === 1 ? "" : "s"} today · every action is attributed to you
          </p>
        </div>
        <Link href="/lookup/phone" className="btn btn-primary">
          <Icon name="search" size={15} />
          New investigation
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Credits" value={user.credits} sub="spend on lookups" icon="card" />
        <Stat label="Total lookups" value={totals.total} sub={`${totals.today} today`} icon="search" />
        <Stat label="Open cases" value={openCases} sub="active dossiers" icon="folder" />
        <Stat label="Watchlist" value={watching} sub="monitored targets" icon="eye" />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Activity · last 14 days</h2>
            <span className="badge mono">{series.reduce((a, b) => a + b, 0)} runs</span>
          </div>
          <div className="mt-4">
            <Sparkline values={series} />
          </div>
          <div className="mt-4 border-t border-line-soft pt-4">
            <h3 className="eyebrow mb-2.5">Recent</h3>
            {recent.length === 0 ? (
              <p className="py-3 text-[12.5px] text-faint">
                No lookups yet. Start with a phone number or an IP address.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Link href={`/history/${r.id}`} className="flex items-center gap-3 py-2.5 hover:text-brass">
                      <Icon
                        name={MODULES.find((m) => m.key === r.module)?.icon ?? "search"}
                        size={13}
                        className="text-faint"
                      />
                      <span className="mono truncate text-[12px]">{r.target}</span>
                      <span className="badge ml-auto shrink-0">{r.module}</span>
                      <span className={`badge shrink-0 ${r.status === "ok" ? "badge-good" : "badge-bad"}`}>
                        {r.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-[13px] font-semibold">Module mix</h2>
          <div className="mt-4 space-y-3">
            {MODULES.map((m) => {
              const n = moduleCount.get(m.key) ?? 0;
              const max = Math.max(1, ...MODULES.map((x) => moduleCount.get(x.key) ?? 0));
              return (
                <Link key={m.key} href={m.href} className="group block">
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="flex items-center gap-2 text-muted group-hover:text-text">
                      <Icon name={m.icon} size={13} className="text-faint" />
                      {m.label}
                    </span>
                    <span className="mono text-faint">{n}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full bg-brass/70 transition-all group-hover:bg-brass"
                      style={{ width: `${(n / max) * 100}%` }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="mt-5 rounded-lg border border-line-soft bg-surface-2/40 p-3.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-brass">
              <Icon name="shield" size={12} /> Handling notice
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
              Results may contain personal data. Record the legal basis in the case file before you
              export or share anything.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
