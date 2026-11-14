import { fetchJson, fetchText } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

/**
 * Domain intelligence: registration (RDAP), live DNS (DoH) and certificate
 * transparency (crt.sh). All three are public, keyless and authoritative enough
 * to state plainly what was observed.
 */

const DOMAIN_RE =
  /^(?=.{4,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

interface RdapResponse {
  handle?: string;
  ldhName?: string;
  status?: string[];
  entities?: Array<{
    roles?: string[];
    vcardArray?: unknown[];
    handle?: string;
  }>;
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  nameservers?: Array<{ ldhName?: string }>;
}

interface DohAnswer {
  Status: number;
  Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
}

const DOH = "https://cloudflare-dns.com/dns-query";
const DNS_TYPES: Record<number, string> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  15: "MX",
  16: "TXT",
  28: "AAAA",
};

async function doh(name: string, type: string): Promise<string[]> {
  const data = await fetchJson<DohAnswer>(
    `${DOH}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    { timeoutMs: 7000, headers: { Accept: "application/dns-json" } },
  );
  return (data.Answer ?? [])
    .filter((a) => DNS_TYPES[a.type] === type || type === "ANY")
    .map((a) => a.data.replace(/^"|"$/g, ""));
}

function vcardName(entity: NonNullable<RdapResponse["entities"]>[number]): string | null {
  const vcard = entity.vcardArray?.[1];
  if (!Array.isArray(vcard)) return null;
  for (const field of vcard) {
    if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string") return field[3];
  }
  return null;
}

async function lookupRdap(domain: string): Promise<{
  registrar: string | null;
  created: string | null;
  expires: string | null;
  updated: string | null;
  statuses: string[];
  nameservers: string[];
} | null> {
  try {
    const data = await fetchJson<RdapResponse>(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      timeoutMs: 10_000,
      headers: { Accept: "application/rdap+json, application/json" },
    });
    const registrarEntity = data.entities?.find((e) => e.roles?.includes("registrar"));
    const event = (action: string) =>
      data.events?.find((e) => e.eventAction === action)?.eventDate ?? null;
    return {
      registrar: registrarEntity ? vcardName(registrarEntity) : null,
      created: event("registration"),
      expires: event("expiration"),
      updated: event("last changed"),
      statuses: data.status ?? [],
      nameservers: (data.nameservers ?? []).map((n) => n.ldhName ?? "").filter(Boolean),
    };
  } catch {
    return null;
  }
}

async function lookupSubdomains(domain: string): Promise<string[]> {
  try {
    const text = await fetchText(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`, {
      timeoutMs: 12_000,
      headers: { Accept: "application/json" },
    });
    const rows = JSON.parse(text) as Array<{ name_value?: string }>;
    const names = new Set<string>();
    for (const row of rows) {
      for (const name of String(row.name_value ?? "").split("\n")) {
        const cleaned = name.trim().toLowerCase();
        if (cleaned.endsWith(domain) && cleaned !== domain && cleaned.includes(".")) names.add(cleaned);
      }
    }
    return [...names].sort().slice(0, 200);
  } catch {
    return [];
  }
}

export async function investigateDomain(raw: string): Promise<ModuleResult> {
  const started = Date.now();
  const domain = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");

  const sources: SourceRef[] = [
    { name: "RDAP (rdap.org)", kind: "public-api" },
    { name: "Cloudflare DNS-over-HTTPS", kind: "public-api" },
    { name: "crt.sh certificate transparency", kind: "public-api" },
  ];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  if (!DOMAIN_RE.test(domain)) {
    return {
      module: "domain",
      target: domain,
      durationMs: Date.now() - started,
      sources,
      signals: [{ label: "Not a valid registrable domain", level: "high" }],
      data: { domain, valid: false },
      warnings: ["Pass a bare domain such as example.co.id."],
    };
  }

  const [rdap, a, aaaa, mx, ns, txt, subdomains] = await Promise.all([
    lookupRdap(domain),
    doh(domain, "A").catch(() => []),
    doh(domain, "AAAA").catch(() => []),
    doh(domain, "MX").catch(() => []),
    doh(domain, "NS").catch(() => []),
    doh(domain, "TXT").catch(() => []),
    lookupSubdomains(domain),
  ]);

  if (!rdap) warnings.push("RDAP did not answer; registration fields are empty and may be rate-limited.");
  if (a.length) signals.push({ label: `Resolves to ${a.length} IPv4 address(es)`, level: "info" });
  else signals.push({ label: "No A record observed", level: "low" });
  if (mx.length) signals.push({ label: `${mx.length} MX record(s) — mail is hosted elsewhere unless self-hosted`, level: "info" });
  if (subdomains.length) {
    signals.push({ label: `${subdomains.length} subdomain(s) seen in certificate transparency`, level: "info" });
  }
  if (txt.some((t) => /v=spf1/i.test(t))) {
    signals.push({ label: "SPF policy published", level: "info" });
  }

  return {
    module: "domain",
    target: domain,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      domain,
      valid: true,
      registrar: rdap?.registrar ?? null,
      created: rdap?.created ?? null,
      expires: rdap?.expires ?? null,
      updated: rdap?.updated ?? null,
      statuses: rdap?.statuses ?? [],
      nameServers: rdap?.nameservers.length ? rdap.nameservers : ns,
      dns: { A: a, AAAA: aaaa, MX: mx, NS: ns, TXT: txt },
      subdomains,
      subdomainCount: subdomains.length,
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
