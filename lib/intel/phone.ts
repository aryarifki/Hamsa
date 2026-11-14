import { parsePhoneNumberFromString, type PhoneNumber } from "libphonenumber-js/max";
import { fetchJson } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

/**
 * Offline carrier table for Indonesia (the dominant market for this class of
 * tool). Prefixes are the national significant number without the trunk "0".
 * Only used when no carrier provider is configured — provider answers win.
 */
export const ID_CARRIERS: Array<[RegExp, string]> = [
  [/^81[123]/, "Telkomsel"],
  [/^82[123]/, "Telkomsel"],
  [/^85[123]/, "Telkomsel"],
  [/^81[456]/, "Indosat Ooredoo"],
  [/^85[5678]/, "Indosat Ooredoo"],
  [/^81[789]/, "XL Axiata"],
  [/^859/, "XL Axiata"],
  [/^87[78]/, "XL Axiata"],
  [/^83[123]/, "AXIS"],
  [/^838/, "AXIS"],
  [/^89[56789]/, "Tri (3)"],
  [/^88[1-9]/, "Smartfren"],
  [/^8[2-9]\d/, "Telkom (fixed / Flexi)"],
];

const TYPE_LABEL: Record<string, string> = {
  MOBILE: "Mobile",
  FIXED_LINE: "Fixed line",
  FIXED_LINE_OR_MOBILE: "Fixed line or mobile",
  TOLL_FREE: "Toll free",
  PREMIUM_RATE: "Premium rate",
  SHARED_COST: "Shared cost",
  VOIP: "VoIP",
  PERSONAL_NUMBER: "Personal number",
  PAGER: "Pager",
  UAN: "Universal access number",
  VOICEMAIL: "Voicemail",
};

export interface PhoneReport {
  input: string;
  valid: boolean;
  possible: boolean;
  e164: string | null;
  national: string | null;
  international: string | null;
  rfc3966: string | null;
  country: string | null;
  countryName: string | null;
  callingCode: string | null;
  type: string | null;
  typeLabel: string | null;
  carrier: string | null;
  carrierSource: "provider" | "offline-prefix" | null;
  timezones: string[];
  investigationLinks: Array<{ label: string; url: string }>;
}

interface NumverifyResponse {
  valid: boolean;
  number?: string;
  local_format?: string;
  international_format?: string;
  country_prefix?: string;
  country_code?: string;
  country_name?: string;
  location?: string;
  carrier?: string;
  line_type?: string;
}

function countryName(iso: string | undefined): string | null {
  if (!iso) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

function offlineCarrier(national: string): string | null {
  for (const [pattern, carrier] of ID_CARRIERS) {
    if (pattern.test(national)) return carrier;
  }
  return null;
}

async function lookupCarrier(e164: string): Promise<{ carrier: string | null; source: "provider" | null }> {
  const key = process.env.NUMVERIFY_KEY;
  if (!key) return { carrier: null, source: null };
  try {
    const data = await fetchJson<NumverifyResponse>(
      `https://apilayer.net/api/validate?access_key=${encodeURIComponent(key)}&number=${encodeURIComponent(e164)}&format=1`,
      { timeoutMs: 7000 },
    );
    if (!data.valid) return { carrier: null, source: null };
    return { carrier: data.carrier?.trim() || null, source: "provider" };
  } catch {
    return { carrier: null, source: null };
  }
}

function buildReport(number: PhoneNumber, input: string, iso?: string): PhoneReport {
  const rawType = number.getType();
  return {
    input,
    valid: number.isValid(),
    possible: number.isPossible(),
    e164: number.number,
    national: number.formatNational(),
    international: number.formatInternational(),
    rfc3966: number.format("RFC3966"),
    country: number.country ?? iso ?? null,
    countryName: countryName(number.country ?? iso),
    callingCode: number.countryCallingCode,
    type: rawType ?? null,
    typeLabel: rawType ? (TYPE_LABEL[rawType] ?? rawType) : null,
    carrier: null,
    carrierSource: null,
    timezones: [],
    investigationLinks: [],
  };
}

export async function investigatePhone(raw: string, defaultCountry = "ID"): Promise<ModuleResult> {
  const started = Date.now();
  const input = raw.trim();
  const sources: SourceRef[] = [
    { name: "libphonenumber (offline metadata)", kind: "offline" },
  ];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  const parsed = parsePhoneNumberFromString(input, defaultCountry as never);

  if (!parsed) {
    return {
      module: "phone",
      target: input,
      durationMs: Date.now() - started,
      sources,
      signals: [{ label: "Not parseable as a phone number", level: "high" }],
      data: { input, valid: false },
      warnings: ["Input could not be parsed. Include a country code (e.g. +62...) or set a default region."],
    };
  }

  const report = buildReport(parsed, input, defaultCountry);
  const national = parsed.nationalNumber;

  if (parsed.isValid()) {
    signals.push({ label: "Number passes E.164 validation", level: "info" });
  } else {
    signals.push({ label: "Number fails E.164 validation", level: "medium" });
  }

  // Carrier: provider first, offline heuristic second.
  const provider = await lookupCarrier(parsed.number);
  if (provider.source === "provider") {
    sources.push({ name: "Numverify", kind: "provider" });
    report.carrier = provider.carrier;
    report.carrierSource = "provider";
  } else {
    const offline = offlineCarrier(national);
    if (offline) {
      report.carrier = offline;
      report.carrierSource = "offline-prefix";
      sources.push({ name: "Hamsa offline prefix table", kind: "derived" });
    }
    if (!process.env.NUMVERIFY_KEY) {
      warnings.push("NUMVERIFY_KEY is not configured — carrier is inferred from prefix tables and may be stale.");
    }
  }

  if (report.type === "VOIP") {
    signals.push({ label: "VoIP range — weak identity binding", level: "high" });
  }
  if (report.type === "PREMIUM_RATE") {
    signals.push({ label: "Premium-rate range", level: "medium" });
  }
  if (!report.carrier) {
    signals.push({ label: "Carrier could not be resolved", level: "low" });
  }

  const digits = parsed.number.replace("+", "");
  report.investigationLinks = [
    {
      label: "WhatsApp",
      url: `https://wa.me/${digits}`,
    },
    {
      label: "Google dork",
      url: `https://www.google.com/search?q=${encodeURIComponent(`"${parsed.formatInternational()}"`)}`,
    },
    {
      label: "PhoneInfoga dork",
      url: `https://www.google.com/search?q=${encodeURIComponent(`"${parsed.formatInternational()}" OR "${digits}"`)}`,
    },
  ];

  return {
    module: "phone",
    target: parsed.number,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: report as unknown as Record<string, unknown>,
    warnings: warnings.length ? warnings : undefined,
  };
}

export function normalizePhone(raw: string, defaultCountry = "ID"): string | null {
  return parsePhoneNumberFromString(raw.trim(), defaultCountry as never)?.number ?? null;
}
