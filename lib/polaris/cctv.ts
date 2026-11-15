/**
 * Polaris CCTV data layer — Phone-X parity.
 *
 * Static bundle (`data/polaris-cctv-cameras.json`, 2841 cameras) is shipped to
 * the client the same way Phone-X ships its static arrays. Runtime catalogs
 * (`data/polaris-cctv-catalogs/<slug>.json`) are fetched when the surveillance
 * tool opens. Upstream resolution stays server-side (relay) or client-direct
 * per the registry in `app/api/v1/osiris/cctv/[slug]/[id]`.
 */

export type CameraCategory = "city" | "toll" | "mountain" | "dam" | "terminal" | "port" | "other";

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
  directPlaylistUrl?: string;
  relayPlaylistUrl?: string;
  streamKind?: string;
  status?: string;
  updatedAt?: string;
  sourceHealth?: string;
  sourceCheckedAt?: string;
  coordinateSource?: string;
  /** Runtime-catalog extras. */
  streamId?: string;
}

export interface CatalogDump {
  city: { slug?: string; name?: string };
  cameras: PolarisCamera[];
}

export const CCTV_CATEGORIES = [
  { key: "all", label: "SEMUA" },
  { key: "favorite", label: "FAVORIT" },
  { key: "toll", label: "JALAN TOL" },
  { key: "city", label: "KOTA" },
  { key: "mountain", label: "GUNUNG" },
  { key: "dam", label: "BENDUNGAN" },
  { key: "terminal", label: "TERMINAL" },
  { key: "port", label: "PELABUHAN" },
  { key: "other", label: "LAINNYA" },
] as const;

export type CategoryKey = (typeof CCTV_CATEGORIES)[number]["key"];

/* ─────────────── classifier (port of Phone-X `Gn`) ─────────────── */

const TOLL = ["binamarga-tol-", "binamarga-palindra-", "margamandala-", "trans jabar tol", "jalan tol", "jasa marga", "hutama karya"];
const DAM_KW = ["bendungan", "waduk", "embung", "pintu air", "reservoir"];
const TERMINAL_KW = ["terminal", "stasiun", "halte", "bandara", "airport", "railway", "kereta"];
const PORT_KW = ["pelabuhan", "dermaga", "harbour", "harbor", "seaport", "ferry"];
const CITY_OVERRIDE = ["bendungan hilir", "bendungan prisdo", "rawa bendungan"];
const CITY_SOURCE = ["dinas kominfo gunungkidul", "cctv kab. cirebon"];
const DAM_SOURCE = ["bbws citarum", "sipapa pusdataru", "sipantau dpupr kota tangerang", "pakuan network · youtube live bendung katulampa"];
const MOUNTAIN_NAME = ["gunung api", "merapi", "semeru", "bromo", "rinjani", "kawah", "volcano"];
const MOUNTAIN_HINT = ["pantau", "pantauan", "monitor", "monitoring", "observatory", "pengamatan", "posko", "pvmbg", "ppga", "bpbd", "kamera", "view"];

function wordMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(haystack);
}

function isMountain(cam: PolarisCamera): boolean {
  const name = [cam.name, cam.place].filter(Boolean).join(" ").toLocaleLowerCase("id-ID");
  const source = (cam.sourceName ?? "").toLocaleLowerCase("id-ID");
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
    .join(" ")
    .toLocaleLowerCase("id-ID");
  const source = (cam.sourceName ?? "").toLocaleLowerCase("id-ID");

  if (CITY_OVERRIDE.some((i) => wordMatch(blob, i))) return "city";
  if (TOLL.some((i) => blob.includes(i))) return "toll";
  if (isMountain(cam)) return "mountain";
  if (DAM_SOURCE.some((i) => source.includes(i))) return "dam";
  for (const kind of ["dam", "terminal", "port"] as const) {
    const keywords = kind === "dam" ? DAM_KW : kind === "terminal" ? TERMINAL_KW : PORT_KW;
    if (keywords.some((t) => (kind === "dam" ? wordMatch(blob, t) : blob.includes(t)))) return kind;
  }
  return CITY_SOURCE.some((i) => source.includes(i)) || /\bkota\b/.test((cam.city ?? "").toLocaleLowerCase("id-ID"))
    ? "city"
    : "other";
}

/* ─────────────────── runtime catalog slugs ─────────────────── */

/** Slugs Phone-X reports as persistently unavailable (salatiga: 502 → empty). */
export const UNAVAILABLE_CATALOGS = ["salatiga"] as const;
