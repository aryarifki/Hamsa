import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { historyFor } from "@/lib/lookup";
import { Icon, type IconName } from "@/components/Icon";
import type { ModuleKey } from "@/lib/intel/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "History" };

const MODULE_ICON: Record<ModuleKey, IconName> = {
  phone: "phone",
  ip: "globe",
  email: "mail",
  username: "at",
  telegram: "send",
  hlr: "phone",
  whatsapp: "send",
  getcontact: "users",
  ewallet: "card",
  breach: "alert",
  humint: "eye",
  "public-evidence": "eye",
  name: "users",
  domain: "globe",
  "telegram-analytics": "send",
};

export default async function HistoryPage() {
  const user = await requireUser();
  const rows = await historyFor(user.id, 200);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Lookup history</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            Every query you have run, newest first. Entries are immutable.
          </p>
        </div>
        <span className="badge mono">{rows.length} records</span>
      </header>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Icon name="clock" size={22} className="mx-auto text-faint" />
            <p className="mt-3 text-[13px] text-muted">No lookups yet.</p>
            <Link href="/lookup/phone" className="btn btn-primary mt-4">
              Run the first one
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Cost</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="flex items-center gap-2 text-[12px] text-muted">
                        <Icon name={MODULE_ICON[r.module]} size={13} className="text-faint" />
                        {r.module}
                      </span>
                    </td>
                    <td className="mono max-w-[280px] truncate text-[12px]">{r.target}</td>
                    <td>
                      <span className={`badge ${r.status === "ok" ? "badge-good" : "badge-bad"}`}>{r.status}</span>
                    </td>
                    <td className="mono text-[12px] text-muted">{r.cost}</td>
                    <td className="whitespace-nowrap text-[11.5px] text-faint">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="text-right">
                      <Link href={`/history/${r.id}`} className="btn btn-ghost px-2 py-1 text-[11px]">
                        Open <Icon name="arrow" size={11} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
