import { mapLimit } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

/**
 * Public-evidence sweep.
 *
 * The same four categories Phone-X reports — social media, marketplaces,
 * hosting, online media — but every hit is a URL that was actually fetched.
 * Profile-style targets are probed with soft-404 detection; phone targets get
 * the search deep links each platform exposes, with a `gated` flag when the
 * platform refuses anonymous access (so "not found" is never inferred from a
 * login wall).
 */

export interface EvidenceEntry {
  category: "socialMedia" | "marketplaces" | "hosting" | "onlineMedia";
  name: string;
  url: string;
  found: boolean | null;
  gated: boolean;
}

interface ProbeSite {
  category: EvidenceEntry["category"];
  name: string;
  url: (target: string, digits: string) => string;
  /** Whether the URL pattern is a profile (probeable) or a search (link only). */
  kind: "profile" | "search";
}

const SITES: ProbeSite[] = [
  { category: "socialMedia", name: "Facebook", kind: "search", url: (_t, d) => `https://www.facebook.com/search/top?q=${encodeURIComponent(d)}` },
  { category: "socialMedia", name: "Instagram", kind: "profile", url: (t, d) => (t === d ? `https://www.instagram.com/${t}/` : `https://www.instagram.com/${t}/`) },
  { category: "socialMedia", name: "TikTok", kind: "profile", url: (t) => `https://www.tiktok.com/@${t}` },
  { category: "socialMedia", name: "X (Twitter)", kind: "profile", url: (t, d) => (t === d ? `https://x.com/search?q=${encodeURIComponent(d)}` : `https://x.com/${t}`) },
  { category: "socialMedia", name: "Threads", kind: "profile", url: (t) => `https://www.threads.net/@${t}` },
  { category: "socialMedia", name: "LinkedIn", kind: "search", url: (t, d) => `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(t === d ? d : t)}` },
  { category: "socialMedia", name: "Telegram", kind: "profile", url: (t) => `https://t.me/${t}` },
  { category: "marketplaces", name: "Tokopedia", kind: "search", url: (_t, d) => `https://www.tokopedia.com/search?q=${encodeURIComponent(d)}` },
  { category: "marketplaces", name: "Shopee", kind: "profile", url: (t) => `https://shopee.co.id/${t}` },
  { category: "marketplaces", name: "Bukalapak", kind: "search", url: (_t, d) => `https://www.bukalapak.com/products?search%5Bkeywords%5D=${encodeURIComponent(d)}` },
  { category: "marketplaces", name: "Lazada", kind: "search", url: (_t, d) => `https://www.lazada.co.id/catalog/?q=${encodeURIComponent(d)}` },
  { category: "marketplaces", name: "OLX", kind: "search", url: (_t, d) => `https://www.olx.co.id/items/q-${encodeURIComponent(d)}` },
  { category: "marketplaces", name: "Carousell", kind: "search", url: (_t, d) => `https://www.carousell.co.id/search/${encodeURIComponent(d)}` },
  { category: "hosting", name: "GitHub", kind: "profile", url: (t) => `https://github.com/${t}` },
  { category: "hosting", name: "GitLab", kind: "profile", url: (t) => `https://gitlab.com/${t}` },
  { category: "hosting", name: "Vercel", kind: "profile", url: (t) => `https://vercel.com/${t}` },
  { category: "hosting", name: "Netlify", kind: "profile", url: (t) => `https://app.netlify.com/teams/${t}` },
  { category: "hosting", name: "Hugging Face", kind: "profile", url: (t) => `https://huggingface.co/${t}` },
  { category: "onlineMedia", name: "Medium", kind: "profile", url: (t) => `https://medium.com/@${t}` },
  { category: "onlineMedia", name: "YouTube", kind: "profile", url: (t) => `https://www.youtube.com/@${t}` },
  { category: "onlineMedia", name: "Kompas", kind: "search", url: (_t, d) => `https://www.kompas.com/search?q=${encodeURIComponent(d)}` },
  { category: "onlineMedia", name: "Detik", kind: "search", url: (_t, d) => `https://www.detik.com/search/searchall?query=${encodeURIComponent(d)}` },
  { category: "onlineMedia", name: "Tribunnews", kind: "search", url: (_t, d) => `https://www.tribunnews.com/search?q=${encodeURIComponent(d)}` },
  { category: "onlineMedia", name: "Google News", kind: "search", url: (_t, d) => `https://news.google.com/search?q=${encodeURIComponent(d)}` },
];

const PHONE_RE = /^\+?\d[\d\s().-]{5,}$/;

async function probe(url: string): Promise<{ found: boolean | null; gated: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Hamsa-OSINT/1.0 (+authorized-investigation-tool)", Accept: "text/html" },
      cache: "no-store",
    });
    const finalUrl = res.url || url;
    const gated = /login|signin|authwall|checkpoint/i.test(finalUrl);
    if (gated) return { found: null, gated: true };
    if (res.status === 404 || res.status === 410) return { found: false, gated: false };
    if (res.status !== 200) return { found: null, gated: false };
    const body = (await res.text()).slice(0, 6000);
    const soft = /page not found|user not found|profile not found|doesn'?t exist|no longer available|akun tidak ditemukan/i.test(body);
    return { found: !soft, gated: false };
  } catch {
    return { found: null, gated: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function investigatePublicEvidence(raw: string): Promise<ModuleResult> {
  const started = Date.now();
  const sources: SourceRef[] = [{ name: "Direct public URL probes", kind: "public-api" }];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  const target = raw.trim().replace(/^@/, "");
  const isPhone = PHONE_RE.test(target);
  const digits = target.replace(/[^\d]/g, "");
  const slug = isPhone ? digits : target;

  const entries: EvidenceEntry[] = await mapLimit(SITES, 6, async (site) => {
    const url = site.url(slug, digits);
    if (site.kind === "search") {
      return { category: site.category, name: site.name, url, found: null, gated: true };
    }
    const result = await probe(url);
    return { category: site.category, name: site.name, url, found: result.found, gated: result.gated };
  });

  const byCategory = (category: EvidenceEntry["category"]) =>
    entries.filter((e) => e.category === category);

  for (const category of ["socialMedia", "marketplaces", "hosting", "onlineMedia"] as const) {
    const hits = byCategory(category).filter((e) => e.found === true);
    if (hits.length) {
      signals.push({ label: `${hits.length} ${category} profile(s) found`, level: "info" });
    }
    byCategory(category).forEach(() => undefined);
  }

  const found = entries.filter((e) => e.found === true);
  const gated = entries.filter((e) => e.gated);
  const unknown = entries.filter((e) => e.found === null && !e.gated);

  if (found.length === 0) {
    signals.push({ label: "No public profile confirmed on the curated list", level: "low" });
  }
  if (gated.length) {
    warnings.push(
      `${gated.length} platform(s) are search-only or login-gated; those links are provided for manual review and were not treated as "not found".`,
    );
  }
  if (unknown.length) {
    warnings.push(`${unknown.length} probe(s) were unreachable or rate-limited.`);
  }

  const summarize = (category: EvidenceEntry["category"]) => {
    const list = byCategory(category);
    return {
      checked: list.length,
      found: list.filter((e) => e.found === true).length,
      urls: list.map((e) => e.url),
      entries: list,
    };
  };

  return {
    module: "public-evidence",
    target,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      target,
      kind: isPhone ? "phone" : "handle",
      categories: {
        socialMedia: summarize("socialMedia"),
        marketplaces: summarize("marketplaces"),
        hosting: summarize("hosting"),
        onlineMedia: summarize("onlineMedia"),
      },
      entries,
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
