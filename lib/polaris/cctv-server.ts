import fs from "node:fs";
import path from "node:path";
import type { CatalogDump, PolarisCamera } from "./cctv";

export const RUNTIME_CATALOG_SLUGS = [
  "bandung",
  "banyuwangi",
  "bojonegoro",
  "depok",
  "gresik",
  "malangkota",
  "semarang",
] as const;

export type RuntimeCatalogSlug = (typeof RUNTIME_CATALOG_SLUGS)[number];

const CATALOG_DIR = path.join(process.cwd(), "data", "polaris-cctv-catalogs");

const cache = new Map<string, PolarisCamera[]>();

/** Dumped catalog for a runtime slug, or null when the slug has no dump. */
export function runtimeCameras(slug: string): PolarisCamera[] | null {
  if (cache.has(slug)) return cache.get(slug) ?? [];
  const file = path.join(CATALOG_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const dump = JSON.parse(fs.readFileSync(file, "utf8")) as CatalogDump;
    const cameras = dump.cameras ?? [];
    cache.set(slug, cameras);
    return cameras;
  } catch {
    cache.set(slug, []);
    return [];
  }
}

/** Find a runtime camera by slug + provider id (relay target lookup). */
export function runtimeCameraById(slug: string, id: string): PolarisCamera | null {
  const list = runtimeCameras(slug);
  if (!list) return null;
  return list.find((c) => c.providerCameraId === id || c.id === id) ?? null;
}

/**
 * Relay upstream registry: slug → upstream playlist URL for a camera id.
 *
 * Known upstreams the Hamsa relay fetches server-side. Hidden-portal slugs
 * (molecool, tangerang, banyuwangi, malangkota) return null and surface the
 * same `upstream_unavailable` failure Phone-X shows.
 */
export function relayUpstream(slug: string, camera: PolarisCamera | null): string | null {
  if (slug === "depok" && camera?.providerCameraId) {
    return `https://dishub.depok.go.id/vi/${camera.providerCameraId}.m3u8`;
  }
  if (slug === "bandung" && camera?.directPlaylistUrl) {
    // K6 validator: pelindung origin, no credentials, dahua-shaped path.
    try {
      const u = new URL(camera.directPlaylistUrl);
      if (
        u.origin === "https://pelindung.bandung.go.id:3443" &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        /^\/video\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,160}\.m3u8$/.test(u.pathname)
      ) {
        return u.href;
      }
    } catch {
      /* malformed URL → no relay */
    }
  }
  return null;
}

/** Segment base for rewriting relative segment URLs in a proxied playlist. */
export function segmentBaseFor(upstream: string): string {
  try {
    const u = new URL(upstream);
    return upstream.slice(0, upstream.length - u.pathname.slice(u.pathname.lastIndexOf("/") + 1).length);
  } catch {
    return "";
  }
}
