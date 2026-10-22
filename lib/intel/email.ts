import { promises as dns } from "node:dns";
import { createHash } from "node:crypto";
import { fetchJson } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

/**
 * Curated disposable / throwaway providers. Not exhaustive by design — this is
 * a fast offline signal, not a guarantee. Provider APIs can be plugged in later.
 */
const DISPOSABLE = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
  "trashmail.com",
  "maildrop.cc",
  "mintemail.com",
  "fakeinbox.com",
  "mohmal.com",
  "emailondeck.com",
  "spamgourmet.com",
  "mailnesia.com",
  "burnermail.io",
  "tempail.com",
]);

const ROLE_PREFIXES = new Set([
  "admin",
  "administrator",
  "support",
  "info",
  "sales",
  "contact",
  "help",
  "billing",
  "security",
  "abuse",
  "postmaster",
  "webmaster",
  "noreply",
  "no-reply",
  "hello",
  "team",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface EmailReport {
  input: string;
  normalized: string;
  validSyntax: boolean;
  localPart: string | null;
  domain: string | null;
  domainExists: boolean | null;
  mxRecords: string[];
  hasMx: boolean;
  disposable: boolean;
  roleAccount: boolean;
  gravatarUrl: string;
  gravatarExists: boolean | null;
  breaches: Array<{ name: string; domain: string; date: string; dataClasses: string[] }> | null;
  breachSource: string | null;
}

async function mxFor(domain: string): Promise<string[]> {
  try {
    const records = await dns.resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
  } catch {
    return [];
  }
}

async function gravatarExists(hash: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://www.gravatar.com/avatar/${hash}?d=404`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 200;
  } catch {
    return null;
  }
}

interface HibpBreach {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  DataClasses: string[];
}

async function hibp(email: string, key: string) {
  return fetchJson<HibpBreach[]>(
    `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
    { timeoutMs: 9000, headers: { "hibp-api-key": key, "User-Agent": "Hamsa-OSINT" } },
  );
}

export async function investigateEmail(raw: string): Promise<ModuleResult> {
  const started = Date.now();
  const input = raw.trim();
  const normalized = input.toLowerCase();
  const sources: SourceRef[] = [{ name: "Hamsa syntax + domain heuristics", kind: "offline" }];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  const validSyntax = EMAIL_RE.test(normalized);
  const [localPart, domain] = validSyntax ? normalized.split("@") : [null, null];

  const report: EmailReport = {
    input,
    normalized,
    validSyntax,
    localPart,
    domain,
    domainExists: null,
    mxRecords: [],
    hasMx: false,
    disposable: false,
    roleAccount: false,
    gravatarUrl: "",
    gravatarExists: null,
    breaches: null,
    breachSource: null,
  };

  if (!validSyntax || !domain || !localPart) {
    return {
      module: "email",
      target: input,
      durationMs: Date.now() - started,
      sources,
      signals: [{ label: "Invalid email syntax", level: "high" }],
      data: report as unknown as Record<string, unknown>,
      warnings: ["Provide a single RFC-5322 address, e.g. analyst@example.com."],
    };
  }

  report.disposable = DISPOSABLE.has(domain);
  report.roleAccount = ROLE_PREFIXES.has(localPart.split("+")[0]);

  if (report.disposable) signals.push({ label: "Disposable / throwaway domain", level: "high" });
  if (report.roleAccount) signals.push({ label: "Role account, not a person", level: "medium" });

  const [mx, grav] = await Promise.all([mxFor(domain), gravatarExists(createHash("md5").update(normalized).digest("hex"))]);
  report.mxRecords = mx;
  report.hasMx = mx.length > 0;
  report.domainExists = mx.length > 0 ? true : null;
  report.gravatarExists = grav;
  report.gravatarUrl = `https://www.gravatar.com/avatar/${createHash("md5").update(normalized).digest("hex")}`;

  if (mx.length) {
    sources.push({ name: "DNS MX", kind: "offline" });
    signals.push({ label: `Domain accepts mail via ${mx[0]}`, level: "info" });
  } else {
    signals.push({ label: "No MX records — address is unlikely to receive mail", level: "medium" });
  }
  if (grav) signals.push({ label: "Gravatar profile exists", level: "low" });

  const hibpKey = process.env.HIBP_API_KEY;
  if (hibpKey) {
    try {
      const breaches = await hibp(normalized, hibpKey);
      report.breaches = breaches.map((b) => ({
        name: b.Title || b.Name,
        domain: b.Domain,
        date: b.BreachDate,
        dataClasses: b.DataClasses ?? [],
      }));
      report.breachSource = "Have I Been Pwned";
      sources.push({ name: "Have I Been Pwned", kind: "provider" });
      if (report.breaches.length) {
        signals.push({ label: `Found in ${report.breaches.length} known breach(es)`, level: "high" });
      } else {
        signals.push({ label: "Not present in HIBP's known breaches", level: "info" });
      }
    } catch (err) {
      const status = (err as Error).message;
      if (status.includes("404")) {
        report.breaches = [];
        report.breachSource = "Have I Been Pwned";
        signals.push({ label: "Not present in HIBP's known breaches", level: "info" });
      } else {
        warnings.push(`Breach lookup failed: ${status}`);
      }
    }
  } else {
    warnings.push("HIBP_API_KEY is not configured — breach history was not checked.");
  }

  return {
    module: "email",
    target: normalized,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: report as unknown as Record<string, unknown>,
    warnings: warnings.length ? warnings : undefined,
  };
}
