import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { fetchJson } from "./http";
import { ID_CARRIERS } from "./phone";
import type { ModuleResult, Signal, SourceRef } from "./types";

interface NumverifyResponse {
  valid: boolean;
  carrier?: string;
  country_code?: string;
  country_name?: string;
  line_type?: string;
  location?: string;
}

const TYPE_LABEL: Record<string, string> = {
  MOBILE: "Mobile",
  FIXED_LINE: "Fixed line",
  FIXED_LINE_OR_MOBILE: "Fixed line or mobile",
  TOLL_FREE: "Toll free",
  PREMIUM_RATE: "Premium rate",
  VOIP: "VoIP",
  PERSONAL_NUMBER: "Personal number",
};

function offlineCarrier(national: string): string | null {
  for (const [pattern, carrier] of ID_CARRIERS) {
    if (pattern.test(national)) return carrier;
  }
  return null;
}

/**
 * HLR-style carrier/country resolution.
 *
 * A real HLR query (the GSM database a network consults to route a call) is
 * carrier-grade infrastructure and is not reachable without a commercial
 * interconnect. The module therefore reports what is provable from numbering
 * metadata plus, when `NUMVERIFY_KEY` is present, a live carrier lookup — and
 * labels the source so the analyst knows which one answered.
 */
export async function investigateHlr(raw: string, defaultCountry = "ID"): Promise<ModuleResult> {
  const started = Date.now();
  const input = raw.trim();
  const sources: SourceRef[] = [{ name: "libphonenumber (offline metadata)", kind: "offline" }];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  const parsed = parsePhoneNumberFromString(input, defaultCountry as never);
  if (!parsed) {
    return {
      module: "hlr",
      target: input,
      durationMs: Date.now() - started,
      sources,
      signals: [{ label: "Not parseable as a phone number", level: "high" }],
      data: { input, resolved: false },
      warnings: ["Include a country code (e.g. +62...) or use an international format."],
    };
  }

  const e164 = parsed.number;
  let carrier: string | null = null;
  let carrierSource: "provider" | "offline-prefix" | null = null;
  let lineType: string | null = null;

  const key = process.env.NUMVERIFY_KEY;
  if (key) {
    try {
      const data = await fetchJson<NumverifyResponse>(
        `https://apilayer.net/api/validate?access_key=${encodeURIComponent(key)}&number=${encodeURIComponent(e164)}&format=1`,
        { timeoutMs: 7000 },
      );
      if (data.valid) {
        sources.push({ name: "Numverify", kind: "provider" });
        carrier = data.carrier?.trim() || null;
        carrierSource = "provider";
        lineType = data.line_type?.trim() || null;
      }
    } catch (err) {
      warnings.push(`Carrier provider failed: ${(err as Error).message}`);
    }
  }

  if (!carrier) {
    const offline = offlineCarrier(parsed.nationalNumber);
    if (offline) {
      carrier = offline;
      carrierSource = "offline-prefix";
      sources.push({ name: "Hamsa offline prefix table", kind: "derived" });
    }
  }

  const type = parsed.getType();
  const networkType = lineType ?? (type ? (TYPE_LABEL[type] ?? type) : null);
  const mcc = parsed.countryCallingCode;

  signals.push({
    label: `Number is ${parsed.isValid() ? "valid" : "not valid"} for country ${parsed.country ?? "unknown"}`,
    level: parsed.isValid() ? "info" : "medium",
  });
  if (carrier) {
    signals.push({
      label: `Carrier ${carrier} (${carrierSource === "provider" ? "live lookup" : "prefix inference"})`,
      level: carrierSource === "provider" ? "info" : "low",
    });
  } else {
    signals.push({ label: "Carrier could not be resolved", level: "low" });
  }
  if (!process.env.NUMVERIFY_KEY) {
    warnings.push(
      "NUMVERIFY_KEY is not configured. Carrier and line type come from offline prefix tables and may be stale; an HLR attach state is not available.",
    );
  }

  return {
    module: "hlr",
    target: e164,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      e164,
      country: parsed.country ?? null,
      countryCallingCode: mcc,
      carrier,
      carrierSource,
      networkType,
      status: carrier ? "resolved" : "unknown",
      attach: "unknown",
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
