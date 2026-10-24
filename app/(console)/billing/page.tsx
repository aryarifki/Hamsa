import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ledgerFor, costOf } from "@/lib/tokens";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Credits" };

const PRICES = [
  { label: "Phone intelligence", module: "phone" as const },
  { label: "IP intelligence", module: "ip" as const },
  { label: "Email intelligence", module: "email" as const },
  { label: "Username sweep", module: "username" as const },
  { label: "Telegram public search", module: "telegram" as const },
];

export default async function BillingPage() {
  const user = await requireUser();
  const ledger = await ledgerFor(user.id, 60);

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Account</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Credits</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          Credits meter provider cost and keep usage attributable. Failed lookups are refunded
          automatically.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-[1.1fr_1fr]">
        <div className="card relative overflow-hidden p-6">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full opacity-60 blur-2xl"
            style={{ background: "radial-gradient(circle, rgba(217,178,106,0.2), transparent 70%)" }}
          />
          <p className="eyebrow">Available balance</p>
          <p className="mono mt-2 text-[40px] font-semibold leading-none text-brass">{user.credits}</p>
          <p className="mt-2 text-[12px] text-muted">credits</p>
          <p className="mt-5 max-w-sm text-[11.5px] leading-relaxed text-faint">
            Top-ups are granted by an administrator in this deployment — Hamsa ships without a
            payment processor on purpose, so no card data ever touches the box.
          </p>
        </div>

        <div className="card p-5">
          <h2 className="text-[13px] font-semibold">Price list</h2>
          <ul className="mt-3 divide-y divide-line-soft">
            {PRICES.map((p) => (
              <li key={p.module} className="flex items-center justify-between py-2.5 text-[12.5px]">
                <span className="text-muted">{p.label}</span>
                <span className="mono text-text">{costOf(p.module)} cr</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-faint">
            Costs are configurable per deployment via environment variables.
          </p>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <h2 className="text-[13px] font-semibold">Ledger</h2>
          <span className="badge mono">{ledger.length}</span>
        </div>
        {ledger.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-faint">
            No transactions yet.{" "}
            <Link href="/lookup/phone" className="text-brass hover:underline">
              Run a lookup
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Reason</th>
                  <th className="text-right">Δ</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-[11.5px] text-faint">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                    <td className="text-[12.5px]">{l.reason}</td>
                    <td className={`mono text-right text-[12.5px] ${l.delta > 0 ? "text-good" : "text-muted"}`}>
                      {l.delta > 0 ? `+${l.delta}` : l.delta}
                    </td>
                    <td className="mono text-right text-[12.5px]">{l.balance_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="flex items-start gap-2 text-[11px] text-faint">
        <Icon name="shield" size={12} className="mt-0.5 shrink-0" />
        Every debit and credit is written to an append-only ledger with the acting operator, so
        billing and conduct review use the same record.
      </p>
    </div>
  );
}
