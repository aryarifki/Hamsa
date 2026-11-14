"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { CopyButton } from "@/components/DataView";

interface Plan {
  id: string;
  provider: "qris" | "usdt";
  tokens: number;
  amountIdr: number | null;
  amountUsd: number | null;
  label: string;
}

interface Topup {
  id: string;
  provider: string;
  tokens: number;
  amount_idr: number | null;
  amount_usd: string | number | null;
  status: string;
  reference: string;
  created_at: string;
  expires_at: string | null;
}

interface Instructions {
  provider: "qris" | "usdt";
  reference: string;
  tokens: number;
  amountIdr: number | null;
  amountUsd: number | null;
  qrPayload: string | null;
  qrSvg: string | null;
  payAddress: string | null;
  network: string | null;
  expiresAt: string;
  warnings: string[];
}

const rupiah = (value: number | null): string =>
  value === null ? "—" : `Rp ${value.toLocaleString("id-ID")}`;

const usd = (value: number | null): string => (value === null ? "—" : `$${value.toFixed(2)}`);

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : "—");

export function TopupPanel({ initialBalance }: { initialBalance: number }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [topups, setTopups] = useState<Topup[]>([]);
  const [balance, setBalance] = useState(initialBalance);
  const [provider, setProvider] = useState<"qris" | "usdt">("qris");
  const [active, setActive] = useState<Instructions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/topup");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Top-up plans unavailable");
      return;
    }
    setPlans(body.plans as Plan[]);
    setTopups(body.topups as Topup[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While a QR is on screen, poll the reference until the gateway settles it.
  useEffect(() => {
    if (!active || paid) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/v1/topup/${encodeURIComponent(active.reference)}`);
      if (!res.ok) return;
      const body = await res.json().catch(() => ({}));
      if (body.topup?.status === "paid") {
        setPaid(true);
        setActive(null);
        const me = await fetch("/api/v1/tokens/balance");
        if (me.ok) {
          const snapshot = await me.json();
          setBalance(snapshot.balance as number);
        }
        await load();
      }
    }, 6_000);
    return () => clearInterval(timer);
  }, [active, paid, load]);

  const visible = useMemo(() => plans.filter((plan) => plan.provider === provider), [plans, provider]);

  async function create(plan: Plan) {
    setBusy(true);
    setError(null);
    setPaid(false);
    try {
      const res = await fetch("/api/v1/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Top-up could not be created");
      setActive(body.instructions as Instructions);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(reference: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/topup/${encodeURIComponent(reference)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Top-up could not be cancelled");
      if (active?.reference === reference) setActive(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="card card-pad space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow">Buy tokens</p>
          <div className="ml-auto flex gap-2">
            {(["qris", "usdt"] as const).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setProvider(name)}
                className={`btn px-3 py-1 text-[11.5px] ${provider === name ? "btn-primary" : ""}`}
              >
                {name === "qris" ? "QRIS (IDR)" : "USDT"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((plan) => (
            <button
              key={plan.id}
              type="button"
              className="card flex items-center gap-3 px-4 py-3 text-left transition hover:border-brass/40"
              onClick={() => void create(plan)}
              disabled={busy}
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-brass/25 bg-brass/8 text-brass">
                <Icon name="card" size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-text">{plan.tokens} tokens</span>
                <span className="mono block text-[11.5px] text-faint">
                  {plan.provider === "qris" ? rupiah(plan.amountIdr) : usd(plan.amountUsd)}
                </span>
              </span>
            </button>
          ))}
          {visible.length === 0 && <p className="text-[12.5px] text-muted">Loading plans…</p>}
        </div>
      </div>

      {paid && (
        <div className="rounded-xl border border-good/30 bg-good/8 px-4 py-3 text-[12.5px] text-good">
          Payment received — balance is now {balance} credits.
        </div>
      )}

      {error && <div className="rounded-xl border border-bad/30 bg-bad/8 px-4 py-3 text-[12.5px] text-bad">{error}</div>}

      {active && (
        <div className="card card-pad space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">
              {active.provider === "qris" ? "Scan to pay" : "Send the exact amount"} · {active.tokens} tokens
            </p>
            <span className="badge mono ml-auto">{active.reference}</span>
            <CopyButton value={active.reference} label="Copy reference" />
          </div>

          <div className="flex flex-wrap items-start gap-5">
            {active.qrSvg && (
              <div
                className="h-[220px] w-[220px] rounded-lg bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
                // The SVG is produced locally by lib/qr-encode.ts from our own payload.
                dangerouslySetInnerHTML={{ __html: active.qrSvg }}
              />
            )}

            <dl className="grid min-w-[240px] flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12px]">
              <dt className="text-faint">Amount</dt>
              <dd className="mono text-text">
                {active.provider === "qris" ? rupiah(active.amountIdr) : `${usd(active.amountUsd)} (${active.network})`}
              </dd>
              {active.payAddress && (
                <>
                  <dt className="text-faint">Deposit to</dt>
                  <dd className="mono break-all text-text">{active.payAddress}</dd>
                </>
              )}
              <dt className="text-faint">Reference</dt>
              <dd className="mono text-text">{active.reference}</dd>
              <dt className="text-faint">Pay before</dt>
              <dd className="text-muted">{when(active.expiresAt)}</dd>
            </dl>
          </div>

          {active.qrPayload && (
            <div className="space-y-1">
              <p className="text-[11px] text-faint">QRIS payload (paste into a payment app that accepts raw payloads)</p>
              <textarea
                readOnly
                className="input h-16 w-full font-mono text-[10.5px]"
                value={active.qrPayload}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          )}

          {active.warnings.map((warning, index) => (
            <p key={index} className="text-[11.5px] leading-relaxed text-warn">
              · {warning}
            </p>
          ))}

          <div className="flex gap-2">
            <button type="button" className="btn px-3 py-1 text-[11.5px]" onClick={() => setActive(null)}>
              Hide
            </button>
            <button
              type="button"
              className="btn btn-ghost px-3 py-1 text-[11.5px]"
              onClick={() => void cancel(active.reference)}
              disabled={busy}
            >
              Cancel top-up
            </button>
          </div>
        </div>
      )}

      {topups.length > 0 && (
        <div className="card overflow-hidden">
          <p className="eyebrow border-b border-line-soft px-4 py-2.5">Recent top-ups</p>
          <ul className="divide-y divide-line-soft">
            {topups.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12px]">
                <span className="mono text-text">{row.reference}</span>
                <span className="text-muted">{row.tokens} tokens</span>
                <span className="mono text-[11px] text-faint">{row.provider}</span>
                <span
                  className={`badge ${
                    row.status === "paid" ? "badge-good" : row.status === "pending" ? "badge-brass" : ""
                  }`}
                >
                  {row.status}
                </span>
                <span className="ml-auto text-[10.5px] text-faint">{when(row.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
