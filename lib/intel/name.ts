import { fetchText, mapLimit } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

/**
 * Name / identity lookup.
 *
 * Accepts `name` (optionally `location` in the keyword argument) and searches
 * public indexes keyless: DuckDuckGo HTML, Google News RSS and Bing. Results are
 * pointers for an analyst to review, not a verdict — the module never states
 * that two people are the same person.
 */

export interface NameHit {
  engine: string;
  title: string;
  url: string;
  snippet: string;
}

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function parseDuckDuckGo(html: string, limit: number): NameHit[] {
  const hits: NameHit[] = [];
  const blocks = html.split('class="result results_links').slice(1);
  for (const block of blocks) {
    const url = /class="result__a"[^>]*href="([^"]+)"/.exec(block)?.[1] ?? "";
    const title = /class="result__a"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? "";
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? "";
    if (!url) continue;
    const decoded = decodeDuckDuckGo(url);
    hits.push({ engine: "DuckDuckGo", title: stripTags(title), url: decoded, snippet: stripTags(snippet) });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** DuckDuckGo wraps outbound links in `/l/?uddg=<encoded>`. */
function decodeDuckDuckGo(url: string): string {
  const match = /[?&]uddg=([^&]+)/.exec(url);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return url;
    }
  }
  return url.startsWith("//") ? `https:${url}` : url;
}

function parseBing(html: string, limit: number): NameHit[] {
  const hits: NameHit[] = [];
  const blocks = html.split('<li class="b_algo"').slice(1);
  for (const block of blocks) {
    const url = /<a[^>]+href="(https?:\/\/[^"]+)"/.exec(block)?.[1] ?? "";
    const title = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1] ?? "";
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? "";
    if (!url) continue;
    hits.push({ engine: "Bing", title: stripTags(title), url, snippet: stripTags(snippet) });
    if (hits.length >= limit) break;
  }
  return hits;
}

async function searchDuckDuckGo(query: string, limit: number): Promise<NameHit[]> {
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    timeoutMs: 9000,
    headers: { Accept: "text/html" },
  });
  return parseDuckDuckGo(html, limit);
}

async function searchBing(query: string, limit: number): Promise<NameHit[]> {
  const html = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=id`, {
    timeoutMs: 9000,
    headers: { Accept: "text/html", "Accept-Language": "id-ID,id;q=0.9,en;q=0.8" },
  });
  return parseBing(html, limit);
}

export async function investigateName(raw: string, location = ""): Promise<ModuleResult> {
  const started = Date.now();
  const sources: SourceRef[] = [];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 3) {
    return {
      module: "name",
      target: name,
      durationMs: Date.now() - started,
      sources,
      signals: [{ label: "Name is too short to search", level: "medium" }],
      data: { name, hits: [] },
      warnings: ["Provide at least three characters."],
    };
  }

  const query = [ `"${name}"`, location.trim() ? `"${location.trim()}"` : "" ].filter(Boolean).join(" ");

  const engines: Array<{ name: string; run: () => Promise<NameHit[]> }> = [
    { name: "DuckDuckGo", run: () => searchDuckDuckGo(query, 12) },
    { name: "Bing", run: () => searchBing(query, 12) },
  ];

  const settled = await mapLimit(engines, 2, async (engine) => {
    try {
      return { engine: engine.name, hits: await engine.run(), error: null as string | null };
    } catch (err) {
      return { engine: engine.name, hits: [] as NameHit[], error: (err as Error).message };
    }
  });

  const hits: NameHit[] = [];
  for (const result of settled) {
    if (result.error) {
      warnings.push(`${result.engine} search failed: ${result.error}`);
      continue;
    }
    sources.push({ name: result.engine, kind: "public-api" });
    hits.push(...result.hits);
  }

  const unique = new Map<string, NameHit>();
  for (const hit of hits) if (!unique.has(hit.url)) unique.set(hit.url, hit);
  const merged = [...unique.values()].slice(0, 20);

  if (merged.length) {
    signals.push({ label: `${merged.length} public page(s) mention the name`, level: "info" });
  } else {
    signals.push({ label: "No public page matched the name", level: "low" });
  }
  const quoted = merged.filter((h) => `${h.title} ${h.snippet}`.toLowerCase().includes(name.toLowerCase()));
  if (quoted.length) {
    signals.push({ label: `${quoted.length} hit(s) contain the exact name string`, level: "medium" });
  }
  warnings.push(
    "Search hits are candidates, not identity confirmation. Corroborate with a second independent selector before attributing.",
  );

  return {
    module: "name",
    target: name,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      name,
      location: location.trim() || null,
      query,
      count: merged.length,
      hits: merged,
    },
    warnings,
  };
}
