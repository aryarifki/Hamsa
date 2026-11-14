import { fetchJson, fetchText } from "./http";

/**
 * Polaris-X situation layer — public feeds aggregated for the console.
 *
 * Every source here is free and keyless unless noted. A source that is down or
 * unconfigured returns `items: []` plus a warning; one failing feed never sinks
 * the dashboard. Timestamps are ISO-8601 UTC.
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
  kind: "earthquake" | "disaster" | "aviation" | "satellite" | "fire";
  items: SituationItem[];
  fetchedAt: string;
  warnings: string[];
}

const stamp = () => new Date().toISOString();

/** BMKG ships `DateTime` already zoned; older payloads ship a naive local time. */
function bmkgTime(value: string | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().replace(" ", "T");
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}+07:00`;
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Never let one malformed upstream date take down a whole feed. */
function safeIso(value: string | null | undefined, fallbackZone?: string): string | null {
  if (!value) return null;
  const date = new Date(fallbackZone ? `${value}${fallbackZone}` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* ─────────────────────────── BMKG earthquakes ─────────────────────────── */

interface BmkgQuake {
  Tanggal?: string;
  Jam?: string;
  DateTime?: string;
  Magnitude?: string;
  Kedalaman?: string;
  Lintang?: string;
  Bujur?: string;
  Wilayah?: string;
  Potensi?: string;
  Dirasakan?: string;
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(String(value).replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function coord(value: string | undefined, axis: "lat" | "lon"): number | null {
  const n = toNumber(value);
  if (n === null) return null;
  const negative = axis === "lat" ? /LS|S/i.test(value ?? "") : /BB|W/i.test(value ?? "");
  return negative ? -Math.abs(n) : n;
}

async function bmkgFeed(kind: "autogempa" | "gempaterkini" | "gempadirasakan"): Promise<SituationItem[]> {
  const data = await fetchJson<{ Infogempa?: { gempa?: BmkgQuake | BmkgQuake[] } }>(
    `https://data.bmkg.go.id/DataMKG/TEWS/${kind}.json`,
    { timeoutMs: 9000 },
  );
  const raw = data.Infogempa?.gempa;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.slice(0, 40).map((q, i) => ({
    id: `${kind}-${q.DateTime ?? i}-${i}`,
    title: q.Wilayah ?? "Gempa",
    detail: [q.Magnitude ? `M${q.Magnitude}` : null, q.Kedalaman, q.Potensi, q.Dirasakan]
      .filter(Boolean)
      .join(" · "),
    at: bmkgTime(q.DateTime),
    lat: coord(q.Lintang, "lat"),
    lon: coord(q.Bujur, "lon"),
    magnitude: toNumber(q.Magnitude),
    severity: q.Potensi ?? null,
    url: "https://www.bmkg.go.id/gempabumi/",
  }));
}

export async function bmkgEarthquakes(): Promise<SituationFeed> {
  const warnings: string[] = [];
  const items: SituationItem[] = [];
  for (const kind of ["autogempa", "gempaterkini", "gempadirasakan"] as const) {
    try {
      items.push(...(await bmkgFeed(kind)));
    } catch (err) {
      warnings.push(`BMKG ${kind} unavailable: ${(err as Error).message}`);
    }
  }
  return { source: "BMKG", kind: "earthquake", items, fetchedAt: stamp(), warnings };
}

/* ─────────────────────────────── GDACS ─────────────────────────────── */

function rssItems(xml: string): SituationItem[] {
  const blocks = xml.split("<item>").slice(1);
  return blocks.slice(0, 60).map((block, i) => {
    const pick = (tag: string) =>
      new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
    const lat = Number(/<geo:lat>([-\d.]+)<\/geo:lat>/.exec(block)?.[1]);
    const lon = Number(/<geo:long>([-\d.]+)<\/geo:long>/.exec(block)?.[1]);
    const date = pick("pubDate");
    return {
      id: pick("guid") || `gdacs-${i}`,
      title: pick("title") || "Disaster alert",
      detail: pick("description").replace(/<[^>]+>/g, " ").slice(0, 300),
      at: safeIso(date),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      severity: /red/i.test(pick("gdacs:alertlevel")) ? "red" : /orange/i.test(pick("gdacs:alertlevel")) ? "orange" : "green",
      url: pick("link") || undefined,
    };
  });
}

export async function gdacsDisasters(): Promise<SituationFeed> {
  const warnings: string[] = [];
  let items: SituationItem[] = [];
  try {
    const xml = await fetchText("https://www.gdacs.org/xml/rss.xml", { timeoutMs: 10_000 });
    items = rssItems(xml);
  } catch (err) {
    warnings.push(`GDACS feed unavailable: ${(err as Error).message}`);
  }
  return { source: "GDACS", kind: "disaster", items, fetchedAt: stamp(), warnings };
}

/* ───────────────────────────── aviation ───────────────────────────── */

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

interface OpenSkyResponse {
  time: number;
  states: Array<Array<string | number | boolean | null>> | null;
}

const ID_BBOX = { lamin: -11.5, lomin: 94.5, lamax: 6.5, lomax: 141.5 };

export async function openskyFlights(): Promise<{ feed: SituationFeed; aircraft: Aircraft[] }> {
  const warnings: string[] = [];
  let aircraft: Aircraft[] = [];
  try {
    const data = await fetchJson<OpenSkyResponse>(
      `https://opensky-network.org/api/states/all?lamin=${ID_BBOX.lamin}&lomin=${ID_BBOX.lomin}&lamax=${ID_BBOX.lamax}&lomax=${ID_BBOX.lomax}`,
      { timeoutMs: 12_000 },
    );
    aircraft = (data.states ?? []).slice(0, 400).map((s) => ({
      icao24: String(s[0] ?? ""),
      callsign: s[1] ? String(s[1]).trim() : null,
      originCountry: s[2] ? String(s[2]) : null,
      lon: typeof s[5] === "number" ? s[5] : null,
      lat: typeof s[6] === "number" ? s[6] : null,
      altitude: typeof s[7] === "number" ? s[7] : (typeof s[13] === "number" ? s[13] : null),
      onGround: Boolean(s[8]),
      velocity: typeof s[9] === "number" ? s[9] : null,
      heading: typeof s[10] === "number" ? s[10] : null,
    }));
  } catch (err) {
    warnings.push(`OpenSky unavailable: ${(err as Error).message}`);
  }

  return {
    aircraft,
    feed: {
      source: "OpenSky Network",
      kind: "aviation",
      items: aircraft.slice(0, 40).map((a) => ({
        id: a.icao24,
        title: a.callsign ?? a.icao24,
        detail: [a.originCountry, a.altitude !== null ? `${Math.round(a.altitude)} m` : null, a.velocity !== null ? `${Math.round(a.velocity)} m/s` : null]
          .filter(Boolean)
          .join(" · "),
        at: null,
        lat: a.lat,
        lon: a.lon,
      })),
      fetchedAt: stamp(),
      warnings,
    },
  };
}

interface AdsbLolResponse {
  ac?: Array<{
    hex?: string;
    flight?: string;
    lat?: number;
    lon?: number;
    alt_baro?: number | string;
    gs?: number;
    track?: number;
  }>;
}

export async function adsbFlights(lat = -6.2, lon = 106.8, distNm = 120): Promise<{ feed: SituationFeed; aircraft: Aircraft[] }> {
  const warnings: string[] = [];
  let aircraft: Aircraft[] = [];
  try {
    const data = await fetchJson<AdsbLolResponse>(
      `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${distNm}`,
      { timeoutMs: 10_000 },
    );
    aircraft = (data.ac ?? []).slice(0, 300).map((a) => ({
      icao24: a.hex ?? "",
      callsign: a.flight?.trim() || null,
      originCountry: null,
      lat: typeof a.lat === "number" ? a.lat : null,
      lon: typeof a.lon === "number" ? a.lon : null,
      altitude: typeof a.alt_baro === "number" ? a.alt_baro * 0.3048 : null,
      velocity: typeof a.gs === "number" ? a.gs * 0.514444 : null,
      heading: typeof a.track === "number" ? a.track : null,
      onGround: a.alt_baro === "ground",
    }));
  } catch (err) {
    warnings.push(`ADS-B feed unavailable: ${(err as Error).message}`);
  }
  return {
    aircraft,
    feed: { source: "adsb.lol", kind: "aviation", items: [], fetchedAt: stamp(), warnings },
  };
}

/* ──────────────────────────── satellites ──────────────────────────── */

export interface Satellite {
  name: string;
  line1: string;
  line2: string;
}

export async function satellites(): Promise<{ feed: SituationFeed; satellites: Satellite[] }> {
  const warnings: string[] = [];
  const list: Satellite[] = [];
  try {
    const text = await fetchText(
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
      { timeoutMs: 12_000 },
    );
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (let i = 0; i + 2 < lines.length; i += 3) {
      list.push({ name: lines[i].trim(), line1: lines[i + 1], line2: lines[i + 2] });
    }
  } catch (err) {
    warnings.push(`Celestrak unavailable: ${(err as Error).message}`);
  }
  return {
    satellites: list,
    feed: {
      source: "Celestrak",
      kind: "satellite",
      items: list.map((s, i) => ({ id: `sat-${i}`, title: s.name, at: null, lat: null, lon: null })),
      fetchedAt: stamp(),
      warnings,
    },
  };
}

/* ────────────────────────────── fires ────────────────────────────── */

export async function fireDetections(): Promise<SituationFeed> {
  const key = process.env.FIRMS_MAP_KEY?.trim();
  if (!key) {
    return {
      source: "NASA FIRMS",
      kind: "fire",
      items: [],
      fetchedAt: stamp(),
      warnings: ["FIRMS_MAP_KEY is not configured — hotspot layer is disabled. A free key is issued by NASA FIRMS."],
    };
  }
  const warnings: string[] = [];
  const items: SituationItem[] = [];
  try {
    const csv = await fetchText(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/95,-11,141,6/1`,
      { timeoutMs: 15_000 },
    );
    const [header, ...rows] = csv.trim().split(/\r?\n/);
    const cols = header.split(",");
    const idx = (name: string) => cols.findIndex((c) => c.toLowerCase() === name);
    const latI = idx("latitude");
    const lonI = idx("longitude");
    const dateI = idx("acq_date");
    const confI = idx("confidence");
    const frpI = idx("frp");
    for (const row of rows.slice(0, 300)) {
      const cells = row.split(",");
      const lat = Number(cells[latI]);
      const lon = Number(cells[lonI]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      items.push({
        id: `${lat},${lon},${cells[dateI] ?? ""},${items.length}`,
        title: "Thermal anomaly",
        detail: [cells[dateI], confI >= 0 ? `confidence ${cells[confI]}` : null, frpI >= 0 ? `FRP ${cells[frpI]}` : null]
          .filter(Boolean)
          .join(" · "),
        at: safeIso(cells[dateI], "T00:00:00Z"),
        lat,
        lon,
        severity: "hotspot",
      });
    }
  } catch (err) {
    warnings.push(`FIRMS unavailable: ${(err as Error).message}`);
  }
  return { source: "NASA FIRMS", kind: "fire", items, fetchedAt: stamp(), warnings };
}

/* ────────────────────────────── aggregate ────────────────────────────── */

export interface SituationSnapshot {
  quakes: SituationFeed;
  disasters: SituationFeed;
  fires: SituationFeed;
  aviation: SituationFeed;
  flights: Aircraft[];
  satellites: Satellite[];
  fetchedAt: string;
}

/* ─────────────────────────────── news ─────────────────────────────── */

interface NewsSource {
  name: string;
  url: string;
  language: "id" | "en";
}

/**
 * Public RSS only. No aggregator account, no scraping of rendered pages, and
 * every item keeps its canonical link so the analyst can read the source.
 */
const NEWS_SOURCES: NewsSource[] = [
  { name: "Antara", url: "https://www.antara.co.id/rss/", language: "id" },
  { name: "Tempo", url: "https://rss.tempo.co/nasional", language: "id" },
  { name: "CNN Indonesia", url: "https://www.cnnindonesia.com/nasional/rss", language: "id" },
  { name: "Kompas", url: "https://rss.kompas.com/api/feed/all", language: "id" },
  { name: "Google News ID", url: "https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id", language: "id" },
  { name: "GDELT", url: "https://api.gdeltproject.org/api/v2/doc/doc?query=indonesia&mode=artlist&format=rss&maxrecords=40", language: "en" },
];

export async function newsFeed(query = ""): Promise<SituationFeed & { items: SituationItem[] }> {
  const warnings: string[] = [];
  const needle = query.trim().toLowerCase();

  const settled = await Promise.all(
    NEWS_SOURCES.map(async (source) => {
      try {
        const xml = await fetchText(source.url, {
          timeoutMs: 10_000,
          headers: { Accept: "application/rss+xml, application/xml, text/xml" },
        });
        return { source, items: rssItems(xml), error: null as string | null };
      } catch (err) {
        return { source, items: [] as SituationItem[], error: (err as Error).message };
      }
    }),
  );

  const items: SituationItem[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.error) {
      warnings.push(`${result.source.name} unavailable: ${result.error}`);
      continue;
    }
    for (const item of result.items) {
      const key = item.title.toLowerCase();
      if (seen.has(key)) continue;
      if (needle && !`${item.title} ${item.detail ?? ""}`.toLowerCase().includes(needle)) continue;
      seen.add(key);
      items.push({
        ...item,
        id: `${result.source.name}:${item.id}`,
        detail: item.detail ? `${result.source.name} · ${item.detail}` : result.source.name,
      });
    }
  }

  items.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  return {
    source: "Public RSS",
    kind: "disaster",
    items: items.slice(0, 120),
    fetchedAt: stamp(),
    warnings,
  };
}

export async function situationSnapshot(): Promise<SituationSnapshot> {
  const [quakes, disasters, fires, aviation, sats] = await Promise.all([
    bmkgEarthquakes(),
    gdacsDisasters(),
    fireDetections(),
    openskyFlights(),
    satellites(),
  ]);
  return {
    quakes,
    disasters,
    fires,
    aviation: aviation.feed,
    flights: aviation.aircraft,
    satellites: sats.satellites,
    fetchedAt: stamp(),
  };
}
