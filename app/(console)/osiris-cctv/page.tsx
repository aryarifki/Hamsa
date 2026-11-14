"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";

interface CityRow {
  slug: string;
  name: string;
  province: string;
  portal: string | null;
  envKey: string;
  available: boolean;
  cameraCount: number;
  warnings: string[];
}

interface CameraRow {
  id: string;
  name: string;
  kind: string;
  available: boolean;
  portal: string | null;
  frameUrl: string | null;
}

export default function OsirisCctvPage() {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/osiris/cctv");
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Catalogue unavailable");
        setCities(body.cities as CityRow[]);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      setCameras([]);
      setWarnings([]);
      try {
        const res = await fetch(`/api/v1/osiris/cctv/${selected}/catalog`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Catalog unavailable");
        setCameras(body.cameras as CameraRow[]);
        setWarnings((body.warnings ?? []) as string[]);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const active = useMemo(() => cities.find((city) => city.slug === selected) ?? null, [cities, selected]);
  const availableCount = cities.filter((city) => city.available).length;

  return (
    <div className="space-y-6">
      <header className="rise">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-brass/30 bg-brass/8 text-brass">
            <Icon name="camera" size={17} />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Public CCTV</h1>
            <p className="text-[12px] text-muted">
              {cities.length} catalogued cities, {availableCount} with a configured feed. Frames are pulled server-side; stream URLs never reach the browser.
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/8 px-4 py-3 text-[12.5px] text-bad">{error}</div>
      )}

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="card overflow-hidden">
          <p className="eyebrow border-b border-line-soft px-4 py-2.5">Cities</p>
          {loading ? (
            <p className="px-4 py-4 text-[12.5px] text-muted">Loading…</p>
          ) : (
            <ul className="max-h-[560px] divide-y divide-line-soft overflow-auto">
              {cities.map((city) => (
                <li key={city.slug}>
                  <button
                    type="button"
                    onClick={() => setSelected(city.slug)}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-left text-[12px] ${
                      selected === city.slug ? "bg-brass/8 text-text" : "text-muted hover:bg-surface-2/50"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${city.available ? "bg-good" : "bg-line"}`} />
                    <span className="min-w-0 flex-1 truncate">{city.name}</span>
                    <span className="shrink-0 text-[10.5px] text-faint">{city.available ? city.cameraCount : "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="space-y-4">
          {!active && (
            <div className="card card-pad text-[12.5px] text-muted">
              Pick a city to see its cameras. A city can be catalogued without a live feed — the portal link and the
              exact environment variable needed to enable it are shown instead of an invented stream.
            </div>
          )}

          {active && (
            <>
              <div className="card card-pad space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-semibold tracking-tight">{active.name}</h2>
                  <span className="badge mono">{active.province}</span>
                  {active.available ? (
                    <span className="badge badge-good">{active.cameraCount} feed(s)</span>
                  ) : (
                    <span className="badge badge-brass">portal only</span>
                  )}
                  <div className="ml-auto flex gap-2">
                    {active.portal && (
                      <a href={active.portal} target="_blank" rel="noreferrer" className="btn px-3 py-1 text-[11.5px]">
                        Open portal
                      </a>
                    )}
                    {active.available && (
                      <button type="button" className="btn px-3 py-1 text-[11.5px]" onClick={() => setTick((n) => n + 1)}>
                        Refresh frames
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[11.5px] text-faint">
                  Enable more feeds with <span className="mono">{active.envKey}</span> (comma-separated HLS / MJPEG / JPEG URLs).
                </p>
              </div>

              {cameras.length === 0 && (
                <div className="card card-pad text-[12.5px] leading-relaxed text-muted">
                  No stream is configured for this city. Hamsa will not scrape the portal: an embed that silently
                  changes would produce a blank frame that looks like evidence.
                  {warnings.map((warning, i) => (
                    <p key={i} className="mt-2 text-[11.5px] text-warn">
                      · {warning}
                    </p>
                  ))}
                </div>
              )}

              {cameras.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {cameras.map((camera) => (
                    <figure key={camera.id} className="card overflow-hidden">
                      <div className="grid h-[200px] place-items-center bg-black/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${camera.frameUrl}?t=${tick}`}
                          alt={camera.name}
                          className="h-full w-full object-contain"
                          onError={(event) => {
                            (event.target as HTMLImageElement).style.opacity = "0.15";
                          }}
                        />
                      </div>
                      <figcaption className="flex items-center gap-2 border-t border-line-soft px-3 py-2">
                        <span className="text-[12px] text-text">{camera.name}</span>
                        <span className="badge mono ml-auto">{camera.kind}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
