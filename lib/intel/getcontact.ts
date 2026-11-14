import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { fetchJson } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

/** Plain Levenshtein distance — a dependency is not worth six lines. */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length];
}

/**
 * GetContact-style caller-ID tags.
 *
 * The tags live behind a commercial API. The module reads a provider configured
 * with `GETCONTACT_API_URL` + `GETCONTACT_API_KEY` (any JSON endpoint that takes
 * `?phone=<e164>` and returns `{ name?, tags? }`), and reports an honest empty
 * result when no provider is configured rather than inventing a name.
 */

interface ProviderResponse {
  name?: string;
  tags?: string[];
  sources?: Array<{ name?: string; count?: number }>;
}

/** Common Indonesian honorifics that make a tag list readable. */
const TITLE_RE = /^(bapak|ibu|pak|bu|mas|mbak|kak|om|tante|drs|ir|hj|h)\.?\s+/i;

export function normalizeTag(tag: string): string {
  return tag.replace(TITLE_RE, "").replace(/\s+/g, " ").trim().toUpperCase();
}

/** Groups near-duplicate tags so the analyst sees one person, not five spellings. */
export function clusterTags(tags: string[]): Array<{ tag: string; variants: string[] }> {
  const clusters: Array<{ tag: string; variants: string[] }> = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const existing = clusters.find((c) => distance(c.tag, tag) <= Math.max(1, Math.floor(tag.length * 0.15)));
    if (existing) existing.variants.push(raw);
    else clusters.push({ tag, variants: [raw] });
  }
  return clusters.sort((a, b) => b.variants.length - a.variants.length);
}

export async function investigateGetContact(raw: string, defaultCountry = "ID"): Promise<ModuleResult> {
  const started = Date.now();
  const sources: SourceRef[] = [];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry as never);
  const e164 = parsed?.number ?? raw.trim();

  const base = process.env.GETCONTACT_API_URL?.trim();
  const key = process.env.GETCONTACT_API_KEY?.trim();

  let name: string | null = null;
  let tags: string[] = [];
  let providerSources: Array<{ name: string; count: number }> = [];

  if (base && key) {
    try {
      const url = `${base}${base.includes("?") ? "&" : "?"}phone=${encodeURIComponent(e164)}`;
      const data = await fetchJson<ProviderResponse>(url, {
        timeoutMs: 9000,
        headers: { Authorization: `Bearer ${key}`, "x-api-key": key },
      });
      sources.push({ name: "GetContact-compatible provider", kind: "provider" });
      name = data.name?.trim() || null;
      tags = (data.tags ?? []).filter((t) => typeof t === "string" && t.trim().length > 0);
      providerSources = (data.sources ?? []).map((s) => ({
        name: String(s.name ?? "unknown"),
        count: Number(s.count ?? 0),
      }));
    } catch (err) {
      warnings.push(`Provider call failed: ${(err as Error).message}`);
    }
  }

  if (!base || !key) {
    warnings.push(
      "GETCONTACT_API_URL / GETCONTACT_API_KEY are not configured. No caller-ID tags were fetched; configure a provider to fill this module.",
    );
    signals.push({ label: "Caller-ID provider not configured", level: "low" });
  }

  const clusters = clusterTags(tags);
  if (name) signals.push({ label: `Primary name resolved: ${name}`, level: "medium" });
  if (clusters.length) {
    signals.push({ label: `${clusters.length} distinct tag cluster(s) across ${tags.length} raw tag(s)`, level: "info" });
  }
  if (!name && tags.length === 0) {
    signals.push({ label: "No caller-ID tags found", level: "low" });
  }

  return {
    module: "getcontact",
    target: e164,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      found: Boolean(name || tags.length),
      name,
      tags,
      clusters,
      tagSources: providerSources,
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
