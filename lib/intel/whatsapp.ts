import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { ModuleResult, Signal, SourceRef } from "./types";

const DEFAULT_UA = "Hamsa-OSINT/1.0 (+authorized-investigation-tool)";

/**
 * WhatsApp registration probe.
 *
 * WhatsApp has no anonymous "is this number registered" API. The public
 * `wa.me/<number>` landing page is the only keyless surface: it answers 200 for
 * a well-formed number and 404 for input it refuses to render. Because the page
 * itself is client-rendered, a 200 is a *likely* registration signal rather than
 * proof — the module says so instead of overclaiming.
 */
export async function checkWhatsApp(raw: string, defaultCountry = "ID"): Promise<{
  registered: boolean | null;
  digits: string | null;
  status: number | "error";
  link: string | null;
}> {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry as never);
  if (!parsed) return { registered: null, digits: null, status: "error", link: null };

  const digits = parsed.number.replace("+", "");
  const link = `https://wa.me/${digits}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(link, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": DEFAULT_UA, Accept: "text/html" },
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 410) {
      return { registered: false, digits, status: res.status, link };
    }
    if (res.status === 200) {
      const body = await res.text();
      const invalid = /invalid|not on whatsapp|phone number shared via url is invalid/i.test(body.slice(0, 4000));
      return { registered: invalid ? false : true, digits, status: res.status, link };
    }
    return { registered: null, digits, status: res.status, link };
  } catch {
    return { registered: null, digits, status: "error", link };
  } finally {
    clearTimeout(timer);
  }
}

export async function investigateWhatsApp(raw: string, defaultCountry = "ID"): Promise<ModuleResult> {
  const started = Date.now();
  const sources: SourceRef[] = [{ name: "wa.me public landing page", kind: "public-api" }];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  const result = await checkWhatsApp(raw, defaultCountry);
  if (!result.digits) {
    return {
      module: "whatsapp",
      target: raw.trim(),
      durationMs: Date.now() - started,
      sources,
      signals: [{ label: "Not parseable as a phone number", level: "high" }],
      data: { input: raw.trim(), registered: null },
      warnings: ["Include a country code (e.g. +62...) or use an international format."],
    };
  }

  if (result.registered === true) {
    signals.push({ label: "wa.me renders a chat landing page (likely registered)", level: "medium" });
  } else if (result.registered === false) {
    signals.push({ label: "wa.me rejects the number as invalid / not on WhatsApp", level: "info" });
  } else {
    signals.push({ label: "Registration state could not be determined", level: "low" });
    warnings.push("Probe failed or was rate-limited. Retry later or confirm manually.");
  }
  warnings.push(
    "wa.me is client-rendered: a 200 response is consistent with registration but does not prove the account is active.",
  );

  return {
    module: "whatsapp",
    target: `+${result.digits}`,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      registered: result.registered,
      waId: result.digits,
      link: result.link,
      httpStatus: result.status,
    },
    warnings,
  };
}
