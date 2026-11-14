"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";

interface Item {
  id: string;
  title: string;
  detail?: string;
  at: string | null;
  lat: number | null;
  lon: number | null;
  magnitude?: number | null;
  severity?: string | null;
  url?: string;
}

interface Feed {
  source: string;
  items: Item[];
  fetchedAt: string;
  warnings: string[];
}

interface PreviewState {
  active: boolean;
  expiresAt: string | null;
  cooldownUntil: string | null;
  secondsRemaining: number;
  secondsUntilNext: number;
}

interface Aircraft {
  icao24: string;
  callsign: string | null;
  originCountry: string | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  velocity: number | null;
}

const TABS = ["Hazards", "Aviation", "Satellites", "News"] as const;
type Tab = (typeof TABS)[number];

const clock = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const when = (iso: string | null): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
};

export default function PolarisPage() {
  const [tab, setTab] = useState<Tab>("Hazards");
  const [status, setStatus] = useState<PreviewState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [quakes, setQuakes] = useState<Feed | null>(null);
  const [disasters, setDisasters] = useState<Feed | null>(null);
  const [fires, setFires] = useState<Feed | null>(null);
  const [flights, setFlights] = useState<Aircraft[]>([]);
  const [aviationWarnings, setAviationWarnings] = useState<string[]>([]);
  const [satellites, setSatellites] = useState<Array<{ name: string }>>([]);
  const [satWarnings, setSatWarnings] = useState<string[]>([]);
  const [news, setNews] = useState<Feed | null>(null);
  const [query, setQuery] = useState("");

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/v1/osiris/preview/status");
    if (!res.ok) return;
    setStatus((await res.json()) as PreviewState);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [hazards, av, sat, feed] = await Promise.all([
        fetch("/api/v1/osiris/bmkg"),
        fetch("/api/v1/osiris/aviation/opensky"),
        fetch("/api/v1/osiris/aviation/satellites"),
        fetch("/api/v1/osiris/news"),
      ]);

      if (hazards.status === 403) {
        const body = await hazards.json().catch(() => ({}));
        setError(body.error ?? "Preview expired");
        return;
      }

      if (hazards.ok) {
        const body = await hazards.json();
        setQuakes(body.quakes);
        setDisasters(body.disasters);
        setFires(body.fires);
      }
      if (av.ok) {
        const body = await av.json();
        setFlights(body.aircraft ?? []);
        setAviationWarnings(body.feed?.warnings ?? []);
      }
      if (sat.ok) {
        const body = await sat.json();
        setSatellites(body.satellites ?? []);
        setSatWarnings(body.feed?.warnings ?? []);
      }
      if (feed.ok) setNews(await feed.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      await refreshStatus();
    }
  }, [refreshStatus]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.active) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.active]);

  useEffect(() => {
    if (!status?.active) return;
    const timer = setInterval(() => void refreshStatus(), 15_000);
    return () => clearInterval(timer);
  }, [status?.active, refreshStatus]);

  async function start() {
    setError(null);
    const res = await fetch("/api/v1/osiris/preview/status", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Preview could not be started");
      await refreshStatus();
      return;
    }
    setStatus(body as PreviewState);
  }

  async function searchNews() {
    const res = await fetch(`/api/v1/osiris/news?q=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    setNews(await res.json());
  }

  const hazardItems = useMemo(() => {
    const all = [
      ...(quakes?.items ?? []).map((i) => ({ ...i, kind: "earthquake" as const })),
      ...(disasters?.items ?? []).map((i) => ({ ...i, kind: "disaster" as const })),
      ...(fires?.items ?? []).map((i) => ({ ...i, kind: "fire" as const })),
    ];
    return all.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 200);
  }, [quakes, disasters, fires]);

  const warnings = [
    ...(quakes?.warnings ?? []),
    ...(disasters?.warnings ?? []),
    ...(fires?.warnings ?? []),
    ...aviationWarnings,
    ...satWarnings,
    ...(news?.warnings ?? []),
  ];

  return (
    <div className="space-y-6">
      <header className="rise">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-brass/30 bg-brass/8 text-brass">
            <Icon name="globe" size={17} />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Polaris-X</h1>
            <p className="text-[12px] text-muted">
              Live hazard, aviation, satellite and news layer built from public feeds (BMKG, GDACS, OpenSky, Celestrak, RSS).
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {status?.active ? (
              <span className="badge badge-good mono">live · {clock(status.secondsRemaining)} left</span>
            ) : (
              <span className="badge mono">
                {status && status.secondsUntilNext > 0 ? `cooldown · ${clock(status.secondsUntilNext)}` : "preview closed"}
              </span>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={start}
              disabled={Boolean(status?.active) || (status?.secondsUntilNext ?? 0) > 0}
            >
              {status?.active ? "Preview running" : "Start 5-minute preview"}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/8 px-4 py-3 text-[12.5px] text-bad">{error}</div>
      )}

      {!status?.active && (
        <section className="card card-pad text-[12.5px] leading-relaxed text-muted">
          Polaris-X streams for five minutes per window, then cools down for thirty-five. Data is fetched
          only while the window is open; closing it stops all outbound requests.
        </section>
      )}

      {status?.active && (
        <>
          <nav className="flex flex-wrap gap-2">
            {TABS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setTab(name)}
                className={`btn px-3 py-1.5 text-[12px] ${tab === name ? "btn-primary" : ""}`}
              >
                {name}
              </button>
            ))}
            <button type="button" className="btn ml-auto px-3 py-1.5 text-[12px]" onClick={() => void loadAll()} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </nav>

          {tab === "Hazards" && (
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
                <p className="eyebrow">Earthquakes · disasters · thermal anomalies</p>
                <span className="text-[11px] text-faint">{hazardItems.length} items</span>
              </div>
              <ul className="divide-y divide-line-soft">
                {hazardItems.length === 0 && <li className="px-4 py-4 text-[12.5px] text-muted">No items yet.</li>}
                {hazardItems.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-start gap-2 px-4 py-2.5">
                    <span className={`badge ${item.kind === "earthquake" ? "badge-brass" : item.kind === "fire" ? "badge-bad" : ""}`}>
                      {item.kind}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-text">{item.title}</p>
                      {item.detail && <p className="text-[11px] text-faint">{item.detail}</p>}
                    </div>
                    <div className="mono shrink-0 text-right text-[10.5px] text-faint">
                      {item.lat !== null && item.lon !== null && <p>{item.lat.toFixed(2)}, {item.lon.toFixed(2)}</p>}
                      <p>{when(item.at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === "Aviation" && (
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
                <p className="eyebrow">Live aircraft over Indonesia (OpenSky)</p>
                <span className="text-[11px] text-faint">{flights.length} tracked</span>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="sticky top-0 bg-surface-2/80 text-[10.5px] uppercase tracking-wide text-faint">
                    <tr>
                      <th className="px-4 py-2">Callsign</th>
                      <th className="px-4 py-2">ICAO24</th>
                      <th className="px-4 py-2">Origin</th>
                      <th className="px-4 py-2 text-right">Alt (m)</th>
                      <th className="px-4 py-2 text-right">Speed (m/s)</th>
                      <th className="px-4 py-2 text-right">Position</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {flights.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-4 text-muted">No aircraft in the current snapshot.</td>
                      </tr>
                    )}
                    {flights.map((a) => (
                      <tr key={a.icao24}>
                        <td className="mono px-4 py-1.5 text-text">{a.callsign ?? "—"}</td>
                        <td className="mono px-4 py-1.5 text-faint">{a.icao24}</td>
                        <td className="px-4 py-1.5 text-muted">{a.originCountry ?? "—"}</td>
                        <td className="mono px-4 py-1.5 text-right text-muted">{a.altitude !== null ? Math.round(a.altitude) : "—"}</td>
                        <td className="mono px-4 py-1.5 text-right text-muted">{a.velocity !== null ? Math.round(a.velocity) : "—"}</td>
                        <td className="mono px-4 py-1.5 text-right text-faint">
                          {a.lat !== null && a.lon !== null ? `${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "Satellites" && (
            <section className="card card-pad space-y-2">
              <p className="eyebrow">Satellite catalogue (Celestrak · stations)</p>
              {satellites.length === 0 ? (
                <p className="text-[12.5px] text-muted">Catalogue unavailable.</p>
              ) : (
                <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {satellites.map((s) => (
                    <li key={s.name} className="mono rounded-lg border border-line-soft px-3 py-1.5 text-[11.5px] text-muted">
                      {s.name}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {tab === "News" && (
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
                <p className="eyebrow">Public RSS sweep</p>
                <div className="ml-auto flex gap-2">
                  <input
                    className="input h-8 w-56 text-[12px]"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter keyword"
                  />
                  <button type="button" className="btn px-3 py-1 text-[11.5px]" onClick={() => void searchNews()}>
                    Search
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-line-soft">
                {(news?.items ?? []).length === 0 && (
                  <li className="px-4 py-4 text-[12.5px] text-muted">No headlines matched.</li>
                )}
                {(news?.items ?? []).map((item) => (
                  <li key={item.id} className="px-4 py-2.5">
                    <a
                      href={item.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[12.5px] text-text underline decoration-line hover:decoration-brass"
                    >
                      {item.title}
                    </a>
                    <p className="mt-0.5 text-[11px] text-faint">
                      {item.detail} · {when(item.at)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {warnings.length > 0 && (
            <section className="card card-pad">
              <p className="eyebrow mb-2">Feed warnings</p>
              <ul className="space-y-1 text-[11.5px] text-warn">
                {warnings.slice(0, 20).map((warning, i) => (
                  <li key={i}>· {warning}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
