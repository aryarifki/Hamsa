import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { fetchJson } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

/**
 * Breach exposure for a phone number or email address.
 *
 * Phone numbers are not indexed by Have I Been Pwned; the phone path therefore
 * uses a leak-check provider configured with `LEAKCHECK_API_KEY` (the de-facto
 * public API for that dataset). Email addresses use HIBP directly when
 * `HIBP_API_KEY` is present. Without keys the module reports that nothing was
 * checked — it never infers a breach from a vague source.
 */

interface HibpBreach {
  Name: string;
  Title: string;
  BreachDate: string;
  DataClasses?: string[];
  PwnCount?: number;
}

interface LeakCheckResponse {
  found?: number;
  records?: Array<{ source?: { name?: string; date?: string } | string; fields?: string[] }>;
}

async function checkEmail(email: string): Promise<{
  breaches: Array<{ name: string; title: string; date: string; dataClasses: string[]; accounts: number }>;
  source: SourceRef | null;
}> {
  const key = process.env.HIBP_API_KEY?.trim();
  if (!key) return { breaches: [], source: null };

  const data = await fetchJson<HibpBreach[]>(
    `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
    { timeoutMs: 9000, headers: { "hibp-api-key": key, "User-Agent": "Hamsa-OSINT/1.0" } },
  );
  return {
    breaches: (data ?? []).map((b) => ({
      name: b.Name,
      title: b.Title,
      date: b.BreachDate,
      dataClasses: b.DataClasses ?? [],
      accounts: b.PwnCount ?? 0,
    })),
    source: { name: "Have I Been Pwned", kind: "provider" },
  };
}

async function checkPhone(e164: string): Promise<{
  records: Array<{ source: string; date: string | null; fields: string[] }>;
  source: SourceRef | null;
}> {
  const key = process.env.LEAKCHECK_API_KEY?.trim();
  if (!key) return { records: [], source: null };

  const data = await fetchJson<LeakCheckResponse>(
    `https://leakcheck.io/api/v2/query/${encodeURIComponent(e164)}?type=phone`,
    { timeoutMs: 9000, headers: { "X-API-Key": key, Accept: "application/json" } },
  );
  const records = (data.records ?? []).map((r) => ({
    source: typeof r.source === "string" ? r.source : String(r.source?.name ?? "unknown"),
    date: typeof r.source === "object" ? (r.source?.date ?? null) : null,
    fields: r.fields ?? [],
  }));
  return { records, source: { name: "LeakCheck", kind: "provider" } };
}

export async function investigateBreach(raw: string, defaultCountry = "ID"): Promise<ModuleResult> {
  const started = Date.now();
  const sources: SourceRef[] = [];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  const input = raw.trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input);
  const parsed = isEmail ? null : parsePhoneNumberFromString(input, defaultCountry as never);
  const target = isEmail ? input.toLowerCase() : (parsed?.number ?? input);

  let found = false;

  if (isEmail) {
    try {
      const result = await checkEmail(target);
      if (result.source) sources.push(result.source);
      found = result.breaches.length > 0;
      if (found) {
        signals.push({ label: `Email appears in ${result.breaches.length} breach(es)`, level: "high" });
      }
    } catch (err) {
      warnings.push(`HIBP call failed: ${(err as Error).message}`);
    }
    if (!process.env.HIBP_API_KEY) {
      warnings.push("HIBP_API_KEY is not configured — email breach lookup was skipped.");
    }
    return {
      module: "breach",
      target,
      durationMs: Date.now() - started,
      sources,
      signals,
      data: { found, kind: "email", breaches: [] },
      warnings: warnings.length ? warnings : undefined,
    };
  }

  let phoneRecords: Array<{ source: string; date: string | null; fields: string[] }> = [];
  try {
    const result = await checkPhone(target);
    if (result.source) sources.push(result.source);
    phoneRecords = result.records;
    found = phoneRecords.length > 0;
  } catch (err) {
    warnings.push(`Leak-check provider failed: ${(err as Error).message}`);
  }

  if (!process.env.LEAKCHECK_API_KEY) {
    warnings.push(
      "LEAKCHECK_API_KEY is not configured — phone-number breach lookup was skipped. Phone numbers are not covered by HIBP.",
    );
    signals.push({ label: "No breach provider configured for phone numbers", level: "low" });
  }
  if (found) {
    signals.push({ label: `Phone appears in ${phoneRecords.length} leaked record(s)`, level: "high" });
  }

  return {
    module: "breach",
    target,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      found,
      kind: "phone",
      recordCount: phoneRecords.length,
      records: phoneRecords,
      breaches: [],
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
