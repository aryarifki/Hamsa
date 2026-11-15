"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polaris dashboard data layer (Phone-X parity).
 *
 * All reads go through Hamsa's own `/api/v1/osiris/*` endpoints; nothing is
 * proxied to Phone-X. Feeds load only while the preview window is active —
 * the same cost guardrail the rest of the console enforces.
 */

export interface SituationItem {
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

export interface SituationFeed {
  source: string;
  kind: string;
  items: SituationItem[];
  fetchedAt: string;
  warnings: string[];
}

export interface Aircraft {
  icao24: string;
  callsign: string | null;
  originCountry: string | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  onGround: boolean;
}

export interface Satellite {
  name: string;
  line1: string;
  line2: string;
}

export interface BmkgResponse {
  quakes: SituationFeed;
  disasters: SituationFeed;
  fires: SituationFeed;
}

export interface PreviewState {
  active: boolean;
  expiresAt: string | null;
  cooldownUntil: string | null;
  secondsRemaining: number;
  secondsUntilNext: number;
}

/* ─────────────────── persisted UI settings (Phone-X parity) ─────────────────── */

export type ViewMode = "3d" | "2d";
export type Basemap = "map" | "sat";

export interface LayerState {
  quakes: boolean;
  fires: boolean;
  disasters: boolean;
  aircraft: boolean;
  cctv: boolean;
}

export interface HazardState {
  quakes: boolean;
  fires: boolean;
  weather: boolean;
  volcanoes: boolean;
}

const UI_KEY = "hamsa:polaris:ui:v1";
export const CCTV_FAVORITES_KEY = "hamsa:polaris:cctv-favorites:v1";

export interface UiSettings {
  mode: ViewMode;
  basemap: Basemap;
  layers: LayerState;
  hazards: HazardState;
}

export const DEFAULT_UI: UiSettings = {
  mode: "3d",
  basemap: "map",
  layers: { quakes: true, fires: true, disasters: true, aircraft: false, cctv: false },
  hazards: { quakes: true, fires: false, weather: false, volcanoes: false },
};

export function loadUi(): UiSettings {
  try {
    const raw = window.localStorage.getItem(UI_KEY);
    if (!raw) return DEFAULT_UI;
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      ...DEFAULT_UI,
      ...parsed,
      layers: { ...DEFAULT_UI.layers, ...(parsed.layers ?? {}) },
      hazards: { ...DEFAULT_UI.hazards, ...(parsed.hazards ?? {}) },
    };
  } catch {
    return DEFAULT_UI;
  }
}

export function saveUi(settings: UiSettings): void {
  try {
    window.localStorage.setItem(UI_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or disabled — settings stay session-only */
  }
}

export function loadFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(CCTV_FAVORITES_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

export function saveFavorites(favorites: Set<string>): void {
  try {
    window.localStorage.setItem(CCTV_FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch {
    /* ignore */
  }
}

/* ─────────────────────────── periodic helpers ─────────────────────────── */

/** Visitor UUID persisted like Phone-X `phonex:polaris-x:visitor:v1`. */
function visitorId(): string {
  const key = "hamsa:polaris:visitor:v1";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** Presence heartbeat: 25 s interval, only while the tab is visible. */
export function usePresence(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const controller = new AbortController();

    async function beat() {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/v1/polaris/presence/heartbeat", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId: visitorId() }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
        });
        if (!res.ok) throw new Error("Presence unavailable");
        const body = (await res.json()) as { activeVisitors?: unknown };
        const activeVisitors = body.activeVisitors;
        if (typeof activeVisitors !== "number" || !Number.isSafeInteger(activeVisitors) || activeVisitors < 0) {
          throw new Error("Invalid presence");
        }
        setCount(activeVisitors);
      } catch {
        if (!stopped) setCount(null);
      }
    }

    void beat();
    const timer = window.setInterval(beat, 25_000);
    const wake = () => void beat();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [enabled]);

  return count;
}

/* ───────────────────────────── feed hooks ───────────────────────────── */

export async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface Feeds {
  quakes: SituationFeed | null;
  disasters: SituationFeed | null;
  fires: SituationFeed | null;
  aircraft: Aircraft[];
  aviationWarnings: string[];
  satellites: Satellite[];
  satelliteWarnings: string[];
  news: SituationFeed | null;
}

const EMPTY_FEEDS: Feeds = {
  quakes: null,
  disasters: null,
  fires: null,
  aircraft: [],
  aviationWarnings: [],
  satellites: [],
  satelliteWarnings: [],
  news: null,
};

/**
 * Loads the situational feeds while the preview is active. One initial burst
 * (hazard bundle + flights + satellites + news), then quiet re-polls so the
 * map stays live without hammering upstream sources.
 */
export function useFeeds(active: boolean): Feeds {
  const [feeds, setFeeds] = useState<Feeds>(EMPTY_FEEDS);
  const timers = useRef<number[]>([]);

  const burst = useCallback(async () => {
    const [bmkg, aviation, sat, news] = await Promise.all([
      getJson<BmkgResponse>("/api/v1/osiris/bmkg"),
      getJson<{ aircraft: Aircraft[]; feed: SituationFeed }>("/api/v1/osiris/aviation/opensky"),
      getJson<{ satellites: Satellite[]; feed: SituationFeed }>("/api/v1/osiris/aviation/satellites"),
      getJson<SituationFeed>("/api/v1/osiris/news"),
    ]);
    setFeeds({
      quakes: bmkg?.quakes ?? null,
      disasters: bmkg?.disasters ?? null,
      fires: bmkg?.fires ?? null,
      aircraft: aviation?.aircraft ?? [],
      aviationWarnings: aviation?.feed?.warnings ?? [],
      satellites: sat?.satellites ?? [],
      satelliteWarnings: sat?.feed?.warnings ?? [],
      news: news,
    });
  }, []);

  useEffect(() => {
    if (!active) {
      setFeeds(EMPTY_FEEDS);
      return;
    }
    void burst();
    // Hazards move on minute timescales; flights move fast.
    timers.current = [
      window.setInterval(() => void burst(), 90_000),
      window.setInterval(
        () =>
          void getJson<{ aircraft: Aircraft[]; feed: SituationFeed }>(
            "/api/v1/osiris/aviation/opensky",
          ).then((aviation) => {
            if (aviation) {
              setFeeds((prev) => ({
                ...prev,
                aircraft: aviation.aircraft ?? [],
                aviationWarnings: aviation.feed?.warnings ?? [],
              }));
            }
          }),
        30_000,
      ),
    ];
    return () => {
      timers.current.forEach((t) => window.clearInterval(t));
      timers.current = [];
    };
  }, [active, burst]);

  return feeds;
}
