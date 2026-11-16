/**
 * OSIRIS — Indonesian public CCTV (Polaris parity).
 *
 * Ported from Hamsa's Polaris module: the 9-keyword category classifier, the
 * runtime-catalog registry that backs the hidden-upstream relay, and the
 * degenerate-entry filter (dumped catalogs can contain {id, streamUrl:null}
 * rows when a portal is down — a camera with no name cannot be labeled and
 * no coordinates cannot be placed).
 */

export type CameraCategory =
  | 'city'
  | 'toll'
  | 'mountain'
  | 'dam'
  | 'terminal'
  | 'port'
  | 'other';

export interface PolarisCamera {
  id: string;
  providerCameraId?: string;
  name: string;
  place?: string;
  city: string;
  province?: string;
  lat: number;
  lng: number;
  sourceName: string;
  sourceUrl?: string;
  embedUrl?: string | null;
  directPlaylistUrl?: string | null;
  relayPlaylistUrl?: string | null;
  /** Raw dump field (bojonegoro). */
  streamUrl?: string | null;
  /** Snapshot/jpeg stream of a Zoneminder portal (bundle). */
  publishedStreamUrl?: string | null;
  streamKind?: string;
  status?: string;
  updatedAt?: string;
  sourceHealth?: string;
  sourceCheckedAt?: string;
  coordinateSource?: string;
  /** Runtime-catalog extra (malangkota). */
  streamId?: string;
}

export const CCTV_CATEGORIES = [
  { key: 'all', label: 'SEMUA' },
  { key: 'favorite', label: 'FAVORIT' },
  { key: 'toll', label: 'JALAN TOL' },
  { key: 'city', label: 'KOTA' },
  { key: 'mountain', label: 'GUNUNG' },
  { key: 'dam', label: 'BENDUNGAN' },
  { key: 'terminal', label: 'TERMINAL' },
  { key: 'port', label: 'PELABUHAN' },
  { key: 'other', label: 'LAINNYA' },
] as const;

export type CategoryKey = (typeof CCTV_CATEGORIES)[number]['key'];

/* ─────────────── classifier (port of the Phone-X keyword logic) ─────────────── */

const TOLL = ['binamarga-tol-', 'binamarga-palindra-', 'margamandala-', 'trans jabar tol', 'jalan tol', 'jasa marga', 'hutama karya'];
const DAM_KW = ['bendungan', 'waduk', 'embung', 'pintu air', 'reservoir'];
const TERMINAL_KW = ['terminal', 'stasiun', 'halte', 'bandara', 'airport', 'railway', 'kereta'];
const PORT_KW = ['pelabuhan', 'dermaga', 'harbour', 'harbor', 'seaport', 'ferry'];
const CITY_OVERRIDE = ['bendungan hilir', 'bendungan prisdo', 'rawa bendungan'];
const CITY_SOURCE = ['dinas kominfo gunungkidul', 'cctv kab. cirebon'];
const DAM_SOURCE = ['bbws citarum', 'sipapa pusdataru', 'sipantau dpupr kota tangerang', 'pakuan network · youtube live bendung katulampa'];
const MOUNTAIN_NAME = ['gunung api', 'merapi', 'semeru', 'bromo', 'rinjani', 'kawah', 'volcano'];
const MOUNTAIN_HINT = ['pantau', 'pantauan', 'monitor', 'monitoring', 'observatory', 'pengamatan', 'posko', 'pvmbg', 'ppga', 'bpbd', 'kamera', 'view'];

function wordMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(haystack);
}

function isMountain(cam: PolarisCamera): boolean {
  const name = [cam.name, cam.place].filter(Boolean).join(' ').toLocaleLowerCase('id-ID');
  const source = (cam.sourceName ?? '').toLocaleLowerCase('id-ID');
  const hasMountainWord = MOUNTAIN_NAME.some((m) => wordMatch(name, m));
  const hasHintWord = MOUNTAIN_HINT.some((m) => wordMatch(name, m));
  return (
    /^(?:cctv\s+(?:merapi|semeru|bromo)|.*volcano observatory\b|.*mount (?:merapi|semeru|bromo) monitoring\b)/.test(
      source,
    ) ||
    (hasMountainWord && hasHintWord)
  );
}

export function classifyCamera(cam: PolarisCamera): CameraCategory {
  const blob = [cam.id, cam.name, cam.place, cam.city, cam.province, cam.sourceName, cam.sourceUrl]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('id-ID');
  const source = (cam.sourceName ?? '').toLocaleLowerCase('id-ID');

  if (CITY_OVERRIDE.some((i) => wordMatch(blob, i))) return 'city';
  if (TOLL.some((i) => blob.includes(i))) return 'toll';
  if (isMountain(cam)) return 'mountain';
  if (DAM_SOURCE.some((i) => source.includes(i))) return 'dam';
  for (const kind of ['dam', 'terminal', 'port'] as const) {
    const keywords = kind === 'dam' ? DAM_KW : kind === 'terminal' ? TERMINAL_KW : PORT_KW;
    if (keywords.some((t) => (kind === 'dam' ? wordMatch(blob, t) : blob.includes(t)))) return kind;
  }
  return CITY_SOURCE.some((i) => source.includes(i)) || /\bkota\b/.test((cam.city ?? '').toLocaleLowerCase('id-ID'))
    ? 'city'
    : 'other';
}

/* ─────────────────── runtime catalog registry ─────────────────── */

import {
  BANDUNG,
  BANYUWANGI,
  BOJONEGORO,
  DEPOK,
  GRESIK,
  MALANGKOTA,
  SEMARANG,
  BUNDLE,
} from '@/app/api/cctv/indonesia-data/raw';

export const RUNTIME_CATALOG_SLUGS = [
  'bandung',
  'banyuwangi',
  'bojonegoro',
  'depok',
  'gresik',
  'malangkota',
  'semarang',
] as const;

const RUNTIME_CATALOGS: Record<string, PolarisCamera[]> = {
  bandung: BANDUNG,
  banyuwangi: BANYUWANGI,
  bojonegoro: BOJONEGORO,
  depok: DEPOK,
  gresik: GRESIK,
  malangkota: MALANGKOTA,
  semarang: SEMARANG,
};

/** Slugs reported as persistently unavailable upstream (salatiga: 502 → empty). */
export const UNAVAILABLE_CATALOGS = ['salatiga'] as const;

export function runtimeCameras(slug: string): PolarisCamera[] | null {
  const list = RUNTIME_CATALOGS[slug];
  return list ? list : null;
}

export function runtimeCameraById(slug: string, id: string): PolarisCamera | null {
  const list = runtimeCameras(slug);
  if (!list) return null;
  return list.find((c) => c.providerCameraId === id || c.id === id) ?? null;
}

/**
 * Relay upstream registry: slug → upstream playlist URL for a camera id.
 *
 * Known upstreams the relay fetches server-side. Hidden-portal slugs
 * (molecool, tangerang, banyuwangi, malangkota) return null and surface the
 * same `upstream_unavailable` failure Phone-X shows.
 */
export function relayUpstream(slug: string, camera: PolarisCamera | null): string | null {
  if (slug === 'depok' && camera?.providerCameraId) {
    return `https://dishub.depok.go.id/vi/${camera.providerCameraId}.m3u8`;
  }
  if (slug === 'bandung' && camera?.directPlaylistUrl) {
    // K6 validator: pelindung origin, no credentials, dahua-shaped path.
    try {
      const u = new URL(camera.directPlaylistUrl);
      if (
        u.origin === 'https://pelindung.bandung.go.id:3443' &&
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
    return upstream.slice(0, upstream.length - u.pathname.slice(u.pathname.lastIndexOf('/') + 1).length);
  } catch {
    return upstream;
  }
}

/**
 * The merged, de-duplicated camera list the `indonesia` region serves.
 *
 * ponytail: degenerate runtime entries (no name or no coordinates) are dropped
 * here rather than in the UI — an undefined name crashes label rendering and
 * bad coordinates place the marker nowhere.
 *
 * 434 bundle rows carry no id (Bondowoso's Zoneminder snapshots among them).
 * Keying those by id alone would collapse all 434 into one; they get a
 * stable coordinate-derived id instead, so every downstream consumer — the
 * region's id dedupe, client list keys, favorites — sees them as distinct.
 */
let mergedCache: PolarisCamera[] | null = null;

export function indonesiaCameras(): PolarisCamera[] {
  if (mergedCache) return mergedCache;
  const usable = (cam: PolarisCamera) =>
    typeof cam.name === 'string' && cam.name.trim() !== '' && cam.lat != null && cam.lng != null;
  const seen = new Set<string>();
  const merged: PolarisCamera[] = [];
  for (const cam of [...BUNDLE, ...Object.values(RUNTIME_CATALOGS).flat()].filter(usable)) {
    const key = cam.id || `${cam.name}@${cam.lat},${cam.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cam.id ? cam : { ...cam, id: key });
  }
  mergedCache = merged;
  return merged;
}
