"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { CopyButton } from "@/components/DataView";

interface ChainRow {
  id: string;
  code: string;
  label: string;
  active: number;
  views: number;
  created_at: string;
  expires_at: string | null;
  report_count: number;
  last_report_at: string | null;
}

interface ReportRow {
  id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  note: string | null;
  ip: string | null;
  at: string;
}

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : "—");

export default function GeofenceChainPage() {
  const [chains, setChains] = useState<ChainRow[]>([]);
  const [label, setLabel] = useState("");
  const [ttl, setTtl] = useState(72);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/geofint/chains");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Chains unavailable");
      return;
    }
    setChains(body.chains as ChainRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/v1/geofint/chains/${selected}/reports`);
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(body.error ?? "Reports unavailable");
        return;
      }
      setReports(body.reports as ReportRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/geofint/chains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined, ttlHours: ttl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Chain could not be created");
      setLabel("");
      setNotice(`Chain ${body.chain.code} created — share /t/${body.chain.code}`);
      await load();
      setSelected(body.chain.code as string);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clearReports(code: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/geofint/chains/${code}/reports`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Reports could not be cleared");
      setNotice(`Removed ${body.removed} report(s) from ${code}`);
      setReports([]);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(code: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/geofint/chains/${code}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Chain could not be revoked");
      setNotice(`Chain ${code} revoked — new submissions are refused`);
      setReports([]);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const active = chains.find((chain) => chain.code === selected) ?? null;

  return (
    <div className="space-y-6">
      <header className="rise">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-brass/30 bg-brass/8 text-brass">
            <Icon name="pin" size={17} />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Tango chains</h1>
            <p className="text-[12px] text-muted">
              Shareable geofence links. The holder of <span className="mono">/t/&lt;code&gt;</span> can submit a position; only you can read the reports.
            </p>
          </div>
        </div>
      </header>

      {error && <div className="rounded-xl border border-bad/30 bg-bad/8 px-4 py-3 text-[12.5px] text-bad">{error}</div>}
      {notice && (
        <div className="rounded-xl border border-good/30 bg-good/8 px-4 py-3 text-[12.5px] text-good">{notice}</div>
      )}

      <section className="card card-pad space-y-3">
        <p className="eyebrow">New chain</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 space-y-1.5">
            <span className="text-[11px] uppercase tracking-[0.12em] text-faint">Label</span>
            <input
              className="input w-full"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Operation Tango — Jakarta"
              maxLength={120}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] uppercase tracking-[0.12em] text-faint">Lifetime (hours)</span>
            <input
              className="input w-28"
              type="number"
              min={1}
              max={720}
              value={ttl}
              onChange={(event) => setTtl(Number(event.target.value) || 72)}
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>
            Create chain
          </button>
        </div>
        <p className="text-[11px] text-faint">
          A chain code is a capability: anyone who has the link can submit a position until the chain expires or you revoke it.
        </p>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
          <p className="eyebrow">Chains</p>
          <span className="text-[11px] text-faint">{chains.length} total</span>
        </div>
        {chains.length === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-muted">No chains yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {chains.map((chain) => {
              const open = chain.active === 1 && (!chain.expires_at || Date.parse(chain.expires_at) > Date.now());
              return (
                <li key={chain.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => setSelected(chain.code)}
                    className={`text-left text-[12.5px] ${selected === chain.code ? "text-brass" : "text-text"}`}
                  >
                    {chain.label}
                  </button>
                  <span className="mono text-[11px] text-faint">{chain.code}</span>
                  <span className={`badge ${open ? "badge-good" : ""}`}>{open ? "open" : "closed"}</span>
                  <span className="text-[11px] text-faint">{chain.report_count} report(s)</span>
                  <span className="ml-auto text-[10.5px] text-faint">last {when(chain.last_report_at)}</span>
                  <CopyButton value={`/t/${chain.code}`} label="Copy link" />
                  <button type="button" className="btn btn-ghost px-2 py-1 text-[11px]" onClick={() => void revoke(chain.code)}>
                    Revoke
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {active && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
            <p className="eyebrow">Reports · {active.code}</p>
            <span className="text-[11px] text-faint">{reports.length} shown · {active.views} page view(s)</span>
            <button
              type="button"
              className="btn ml-auto px-2 py-1 text-[11px]"
              onClick={() => void clearReports(active.code)}
              disabled={busy || reports.length === 0}
            >
              Clear reports
            </button>
          </div>
          {reports.length === 0 ? (
            <p className="px-4 py-4 text-[12.5px] text-muted">No position has been submitted through this chain.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {reports.map((report) => (
                <li key={report.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12px]">
                  <a
                    className="mono text-brass underline decoration-line"
                    href={`https://www.openstreetmap.org/?mlat=${report.lat}&mlon=${report.lng}#map=17/${report.lat}/${report.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
                  </a>
                  <span className="text-[11px] text-faint">
                    {report.accuracy !== null ? `±${Math.round(report.accuracy)} m` : "accuracy unknown"}
                  </span>
                  {report.note && <span className="text-muted">· {report.note}</span>}
                  <span className="ml-auto text-[10.5px] text-faint">{when(report.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
