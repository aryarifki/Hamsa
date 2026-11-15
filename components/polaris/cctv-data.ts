"use client";

import { useEffect, useMemo, useState } from "react";
import type { PolarisCamera, CameraCategory, CategoryKey } from "@/lib/polaris/cctv";
import { classifyCamera, CCTV_CATEGORIES } from "@/lib/polaris/cctv";
import { getJson } from "./data";

/**
 * Client data layer for the surveillance tool — Phone-X parity.
 *
 * The static bundle is dynamically imported (separate chunk, only when the
 * CCTV tool opens) and runtime catalogs are fetched once from Hamsa's own
 * endpoint. Nothing is proxied to Phone-X.
 */

export interface CctvData {
  cameras: PolarisCamera[];
  loading: boolean;
  /** Slugs Phone-X reports as persistently unavailable. */
  unavailable: string[];
}

let bundleCache: PolarisCamera[] | null = null;

async function loadBundle(): Promise<PolarisCamera[]> {
  if (bundleCache) return bundleCache;
  const mod = (await import("@/data/polaris-cctv-cameras.json")) as { default: PolarisCamera[] };
  bundleCache = mod.default;
  return bundleCache;
}

interface CatalogsResponse {
  catalogs: Record<string, { cameras: PolarisCamera[]; available: boolean }>;
  unavailable: string[];
}

export function useCctvCameras(active: boolean): CctvData {
  const [cameras, setCameras] = useState<PolarisCamera[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string[]>([]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadBundle(),
      getJson<CatalogsResponse>("/api/v1/osiris/polaris/cctv/catalogs").catch(() => null),
    ])
      .then(([bundle, catalogs]) => {
        if (cancelled) return;
        const runtime = catalogs
          ? Object.values(catalogs.catalogs).flatMap((c) => c.cameras)
          : [];
        const seen = new Set<string>();
        const merged: PolarisCamera[] = [];
        for (const cam of [...bundle, ...runtime]) {
          if (seen.has(cam.id)) continue;
          seen.add(cam.id);
          merged.push(cam);
        }
        setCameras(merged);
        setUnavailable(catalogs?.unavailable ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { cameras, loading, unavailable };
}

export function categoryCounts(cameras: PolarisCamera[]): Record<CategoryKey, number> {
  const counts: Record<CategoryKey, number> = {
    all: cameras.length,
    favorite: 0,
    toll: 0,
    city: 0,
    mountain: 0,
    dam: 0,
    terminal: 0,
    port: 0,
    other: 0,
  };
  for (const cam of cameras) {
    counts[classifyCamera(cam)] += 1;
  }
  return counts;
}

export function filterCameras(
  cameras: PolarisCamera[],
  category: CategoryKey,
  favorites: Set<string>,
): PolarisCamera[] {
  if (category === "all") return cameras;
  if (category === "favorite") return cameras.filter((c) => favorites.has(c.id));
  return cameras.filter((c) => classifyCamera(c) === (category as CameraCategory));
}

export const CATEGORY_LIST = CCTV_CATEGORIES;
