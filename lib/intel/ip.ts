import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { fetchJson } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

export interface IpReport {
  ip: string;
  version: 4 | 6 | null;
  scope: "public" | "private" | "loopback" | "link-local" | "reserved" | "invalid";
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postal: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  asn: string | null;
  org: string | null;
  isp: string | null;
  reverseDns: string | null;
  proxy: boolean;
  hosting: boolean;
  mobile: boolean;
  provider: string;
  accuracyNote: string;
}

const PRIVATE_V4 = [
  [/^10\./, "private"],
  [/^127\./, "loopback"],
  [/^169\.254\./, "link-local"],
  [/^192\.168\./, "private"],
  [/^172\.(1[6-9]|2\d|3[01])\./, "private"],
  [/^0\./, "reserved"],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, "reserved"],
  [/^(22[4-9]|2[3-5]\d)\./, "reserved"],
] as const;

function classify(ip: string): IpReport["scope"] {
  if (isIP(ip) === 4) {
    for (const [pattern, scope] of PRIVATE_V4) if (pattern.test(ip)) return scope as IpReport["scope"];
    return "public";
  }
  if (isIP(ip) === 6) {
    if (ip === "::1") return "loopback";
    if (/^fe80:/i.test(ip)) return "link-local";
    if (/^(fc|fd)/i.test(ip)) return "private";
    return "public";
  }
  return "invalid";
}

interface IpWhoIsResponse {
  success: boolean;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  postal?: string;
  latitude?: number;
  longitude?: number;
  timezone?: { id?: string };
  connection?: { asn?: number; org?: string; isp?: string };
  security?: { proxy?: boolean; hosting?: boolean; mobile?: boolean };
}

interface IpinfoResponse {
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
  org?: string;
  timezone?: string;
  bogon?: boolean;
}

async function reverseDns(ip: string): Promise<string | null> {
  try {
    const names = await dns.reverse(ip);
    return names[0] ?? null;
  } catch {
    return null;
  }
}

async function queryIpinfo(ip: string, token: string): Promise<Partial<IpReport>> {
  const data = await fetchJson<IpinfoResponse>(
    `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`,
    { timeoutMs: 7000 },
  );
  if (data.bogon) throw new Error("bogon");
  const [lat, lon] = (data.loc ?? "").split(",").map(Number);
  return {
    country: data.country ?? null,
    countryCode: data.country ?? null,
    region: data.region ?? null,
    city: data.city ?? null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    timezone: data.timezone ?? null,
    org: data.org ?? null,
    asn: data.org?.split(" ")[0]?.startsWith("AS") ? data.org.split(" ")[0] : null,
    provider: "ipinfo.io",
  };
}

async function queryIpwhois(ip: string): Promise<Partial<IpReport>> {
  const data = await fetchJson<IpWhoIsResponse>(`https://ipwho.is/${encodeURIComponent(ip)}`, {
    timeoutMs: 7000,
  });
  if (!data.success) throw new Error("lookup_failed");
  return {
    country: data.country ?? null,
    countryCode: data.country_code ?? null,
    region: data.region ?? null,
    city: data.city ?? null,
    postal: data.postal ?? null,
    latitude: typeof data.latitude === "number" ? data.latitude : null,
    longitude: typeof data.longitude === "number" ? data.longitude : null,
    timezone: data.timezone?.id ?? null,
    asn: data.connection?.asn ? `AS${data.connection.asn}` : null,
    org: data.connection?.org ?? null,
    isp: data.connection?.isp ?? null,
    proxy: Boolean(data.security?.proxy),
    hosting: Boolean(data.security?.hosting),
    mobile: Boolean(data.security?.mobile),
    provider: "ipwho.is",
  };
}

export async function investigateIp(rawIp: string): Promise<ModuleResult> {
  const started = Date.now();
  const ip = rawIp.trim();
  const sources: SourceRef[] = [{ name: "Hamsa address classifier", kind: "offline" }];
  const signals: Signal[] = [];
  const warnings: string[] = [];
  const scope = classify(ip);

  const base: IpReport = {
    ip,
    version: (isIP(ip) || null) as 4 | 6 | null,
    scope,
    country: null,
    countryCode: null,
    region: null,
    city: null,
    postal: null,
    latitude: null,
    longitude: null,
    timezone: null,
    asn: null,
    org: null,
    isp: null,
    reverseDns: null,
    proxy: false,
    hosting: false,
    mobile: false,
    provider: "none",
    accuracyNote: "IP geolocation is city-level at best and never identifies a person or household.",
  };

  if (scope === "invalid") {
    return {
      module: "ip",
      target: ip,
      durationMs: Date.now() - started,
      sources,
      signals: [{ label: "Not a valid IPv4/IPv6 address", level: "high" }],
      data: base as unknown as Record<string, unknown>,
      warnings: ["Provide a literal IP address, not a hostname."],
    };
  }

  if (scope !== "public") {
    signals.push({ label: `Reserved/${scope} address — no external geolocation`, level: "info" });
    return {
      module: "ip",
      target: ip,
      durationMs: Date.now() - started,
      sources,
      signals,
      data: base as unknown as Record<string, unknown>,
    };
  }

  const reverse = await reverseDns(ip);
  if (reverse) {
    base.reverseDns = reverse;
    sources.push({ name: "DNS PTR", kind: "offline" });
  }

  let enriched: Partial<IpReport> | null = null;
  const ipinfoToken = process.env.IPINFO_TOKEN;

  try {
    if (ipinfoToken) {
      enriched = await queryIpinfo(ip, ipinfoToken);
      sources.push({ name: "ipinfo.io", kind: "provider" });
    } else if (process.env.HAMSA_ALLOW_FREE_PROVIDERS !== "false") {
      enriched = await queryIpwhois(ip);
      sources.push({ name: "ipwho.is (public, no key)", kind: "public-api" });
      warnings.push(
        "Using a free public provider. The queried IP is sent to ipwho.is. Set IPINFO_TOKEN for a contractual provider, or HAMSA_ALLOW_FREE_PROVIDERS=false to stay fully offline.",
      );
    } else {
      warnings.push("No IP provider configured and free providers are disabled — offline classification only.");
    }
  } catch (err) {
    warnings.push(`Provider lookup failed: ${(err as Error).message}`);
  }

  if (enriched) Object.assign(base, enriched);

  if (base.proxy) signals.push({ label: "Provider flags this IP as a proxy/VPN", level: "high" });
  if (base.hosting) signals.push({ label: "Hosting/datacenter range", level: "medium" });
  if (base.mobile) signals.push({ label: "Mobile carrier range", level: "low" });
  if (!base.country) signals.push({ label: "No geolocation available", level: "low" });

  return {
    module: "ip",
    target: ip,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: base as unknown as Record<string, unknown>,
    warnings: warnings.length ? warnings : undefined,
  };
}
