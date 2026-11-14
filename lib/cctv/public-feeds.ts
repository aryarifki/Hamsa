import { assertMediaInput, defaultRunner, redactUrl } from "./ffmpeg";

/**
 * Public CCTV catalogue.
 *
 * Hamsa does not scrape city portals: their embeds change without notice and a
 * scraper that silently returns a 200 error page would be worse than no feature.
 * Instead the catalogue names the 31 cities Phone-X advertises, records the
 * public portal an analyst can open by hand, and resolves an actual frame only
 * when the operator supplies a stream URL through
 * `HAMSA_PUBLIC_CCTV_<SLUG>` (e.g. `HAMSA_PUBLIC_CCTV_BANDUNG`).
 *
 * Every entry is therefore explicit about which of the two states it is in:
 * `available` (a stream URL is configured) or `unavailable` (portal link only).
 */

export interface CityEntry {
  slug: string;
  name: string;
  province: string;
  /** Public portal a human can open; may be absent for cities without one. */
  portal: string | null;
  /** Env var that supplies a direct stream URL (HLS, MJPEG or single JPEG). */
  envKey: string;
}

export interface PublicCamera {
  id: string;
  name: string;
  city: string;
  cityName: string;
  streamUrl: string | null;
  portal: string | null;
  available: boolean;
  kind: "hls" | "mjpeg" | "jpeg" | "unknown";
}

export interface CityCatalog {
  city: CityEntry;
  cameras: PublicCamera[];
  warnings: string[];
}

const CITY_DEFS: Array<[slug: string, name: string, province: string, portal: string | null]> = [
  ["bandung", "Bandung", "Jawa Barat", "https://cctv.bandung.go.id/"],
  ["banyuwangi", "Banyuwangi", "Jawa Timur", null],
  ["banjarmasin", "Banjarmasin", "Kalimantan Selatan", null],
  ["surabaya", "Surabaya", "Jawa Timur", "https://cctv.surabaya.go.id/"],
  ["binamarga-tol", "Binamarga (tol)", "Nasional", "https://cctv.binamarga.pu.go.id/"],
  ["binamarga-nontol", "Binamarga (non-tol)", "Nasional", "https://cctv.binamarga.pu.go.id/"],
  ["depok", "Depok", "Jawa Barat", "https://cctv.depok.go.id/"],
  ["bogor", "Bogor", "Jawa Barat", "https://cctv.kotabogor.go.id/"],
  ["cirebon", "Cirebon", "Jawa Barat", null],
  ["semarang", "Semarang", "Jawa Tengah", "https://cctv.semarangkota.go.id/"],
  ["salatiga", "Salatiga", "Jawa Tengah", null],
  ["bojonegoro", "Bojonegoro", "Jawa Timur", null],
  ["gresik", "Gresik", "Jawa Timur", null],
  ["malangkota", "Malang", "Jawa Timur", "https://cctv.malangkota.go.id/"],
  ["situbondo", "Situbondo", "Jawa Timur", null],
  ["ponorogo", "Ponorogo", "Jawa Timur", null],
  ["serangkota", "Serang", "Banten", null],
  ["tangerang", "Tangerang", "Banten", "https://cctv.tangerangkota.go.id/"],
  ["wonosobo", "Wonosobo", "Jawa Tengah", null],
  ["kedirikota", "Kediri", "Jawa Timur", null],
  ["bontang", "Bontang", "Kalimantan Timur", null],
  ["cimahi", "Cimahi", "Jawa Barat", null],
  ["asahan", "Asahan", "Sumatera Utara", null],
  ["bali", "Bali", "Bali", "https://cctv.baliprov.go.id/"],
  ["banggaikab", "Banggai", "Sulawesi Tengah", null],
  ["kobar", "Kotawaringin Barat", "Kalimantan Tengah", null],
  ["kuningankab", "Kuningan", "Jawa Barat", null],
  ["metro", "Metro", "Lampung", null],
  ["molecool", "Molecool", "Maluku", null],
  ["sidokerto", "Sidokerto", "Jawa Timur", null],
  ["sipapa", "Sipapa", "Sulawesi Selatan", null],
];

export const CITIES: CityEntry[] = CITY_DEFS.map(([slug, name, province, portal]) => ({
  slug,
  name,
  province,
  portal,
  envKey: `HAMSA_PUBLIC_CCTV_${slug.replace(/-/g, "_").toUpperCase()}`,
}));

export function cityBySlug(slug: string): CityEntry | undefined {
  return CITIES.find((city) => city.slug === slug.toLowerCase());
}

function streamKind(url: string): PublicCamera["kind"] {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8")) return "hls";
  if (clean.endsWith(".mjpg") || clean.endsWith(".mjpeg") || clean.includes("mjpg")) return "mjpeg";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg") || clean.endsWith(".png")) return "jpeg";
  return "unknown";
}

/**
 * Phone-X names several feeds per city. Without a machine-readable portal the
 * number of real cameras cannot be known, so one configured URL yields one
 * camera named after the city — no invented camera names.
 */
export function catalogFor(slug: string): CityCatalog | undefined {
  const city = cityBySlug(slug);
  if (!city) return undefined;

  const raw = process.env[city.envKey]?.trim();
  const warnings: string[] = [];
  const cameras: PublicCamera[] = [];

  if (raw) {
    const urls = raw.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 12);
    urls.forEach((url, index) => {
      cameras.push({
        id: `${city.slug}-${index + 1}`,
        name: `${city.name} feed ${index + 1}`,
        city: city.slug,
        cityName: city.name,
        streamUrl: url,
        portal: city.portal,
        available: true,
        kind: streamKind(url),
      });
    });
  } else {
    warnings.push(
      `No stream configured for ${city.name}. Set ${city.envKey} to one or more comma-separated HLS/MJPEG/JPEG URLs to enable frames.`,
    );
  }

  return { city, cameras, warnings };
}

export function cameraById(slug: string, id: string): { camera: PublicCamera; city: CityEntry } | null {
  const catalog = catalogFor(slug);
  if (!catalog) return null;
  const camera =
    catalog.cameras.find((entry) => entry.id === id) ??
    // A configured feed is also addressable as `<slug>-1` even if ids shifted.
    null;
  return camera ? { camera, city: catalog.city } : null;
}

export interface FrameResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: Buffer | null;
  warning?: string;
}

/**
 * Pulls one JPEG frame through ffmpeg so HLS and MJPEG sources behave the same.
 * The stream URL never reaches the client, and ffmpeg stderr is redacted before
 * it is surfaced.
 */
export async function capturePublicFrame(url: string, timeoutMs = 15_000): Promise<FrameResult> {
  try {
    await assertMediaInput(url);
  } catch (err) {
    return { ok: false, status: 400, contentType: "application/json", body: null, warning: (err as Error).message };
  }

  const result = await defaultRunner(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      url,
      "-frames:v",
      "1",
      "-f",
      "image2",
      "-vcodec",
      "mjpeg",
      "-q:v",
      "4",
      "pipe:1",
    ],
    { timeoutMs },
  );

  if (result.code !== 0 || result.stdout.length === 0) {
    const detail = redactUrl(result.stderr.slice(-400).trim());
    return {
      ok: false,
      status: 502,
      contentType: "application/json",
      body: null,
      warning: detail || "ffmpeg produced no frame",
    };
  }

  return { ok: true, status: 200, contentType: "image/jpeg", body: result.stdout };
}
