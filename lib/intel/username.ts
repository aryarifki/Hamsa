import { fetchText, mapLimit } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

interface Site {
  name: string;
  url: (u: string) => string;
  /** high = a 404 is definitive; medium = the site may soft-404 or gate content. */
  reliability: "high" | "medium";
}

/**
 * A deliberately small, curated site list. Broad username enumeration belongs
 * in a dedicated tool with per-site adapters; Hamsa ships a fast sanity pass so
 * an analyst can confirm a handle before spending time elsewhere.
 */
const SITES: Site[] = [
  { name: "GitHub", url: (u) => `https://github.com/${u}`, reliability: "high" },
  { name: "GitLab", url: (u) => `https://gitlab.com/${u}`, reliability: "high" },
  { name: "Codeberg", url: (u) => `https://codeberg.org/${u}`, reliability: "high" },
  { name: "Reddit", url: (u) => `https://www.reddit.com/user/${u}`, reliability: "high" },
  { name: "Keybase", url: (u) => `https://keybase.io/${u}`, reliability: "high" },
  { name: "Hugging Face", url: (u) => `https://huggingface.co/${u}`, reliability: "high" },
  { name: "npm", url: (u) => `https://www.npmjs.com/~${u}`, reliability: "high" },
  { name: "PyPI", url: (u) => `https://pypi.org/user/${u}/`, reliability: "high" },
  { name: "Dev.to", url: (u) => `https://dev.to/${u}`, reliability: "high" },
  { name: "Medium", url: (u) => `https://medium.com/@${u}`, reliability: "medium" },
  { name: "About.me", url: (u) => `https://about.me/${u}`, reliability: "medium" },
  { name: "Twitch", url: (u) => `https://www.twitch.tv/${u}`, reliability: "medium" },
  { name: "SoundCloud", url: (u) => `https://soundcloud.com/${u}`, reliability: "high" },
  { name: "Steam", url: (u) => `https://steamcommunity.com/id/${u}`, reliability: "high" },
  { name: "Behance", url: (u) => `https://www.behance.net/${u}`, reliability: "high" },
  { name: "Dribbble", url: (u) => `https://dribbble.com/${u}`, reliability: "high" },
  { name: "Pinterest", url: (u) => `https://www.pinterest.com/${u}/`, reliability: "medium" },
  { name: "TikTok", url: (u) => `https://www.tiktok.com/@${u}`, reliability: "medium" },
  { name: "Instagram", url: (u) => `https://www.instagram.com/${u}/`, reliability: "medium" },
  { name: "YouTube", url: (u) => `https://www.youtube.com/@${u}`, reliability: "medium" },
  { name: "Telegram", url: (u) => `https://t.me/${u}`, reliability: "high" },
  { name: "Mastodon (mastodon.social)", url: (u) => `https://mastodon.social/@${u}`, reliability: "medium" },
];

export interface UsernameHit {
  site: string;
  url: string;
  status: number | "error";
  found: boolean | null;
  reliability: Site["reliability"];
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;

async function probe(site: Site, username: string): Promise<UsernameHit> {
  const url = site.url(username);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Hamsa-OSINT/1.0 (+authorized-investigation-tool)",
        Accept: "text/html",
      },
      cache: "no-store",
    });
    clearTimeout(timer);

    if (res.status === 404 || res.status === 410) {
      return { site: site.name, url, status: res.status, found: false, reliability: site.reliability };
    }
    if (res.status === 200) {
      // Soft-404 detection: some platforms return 200 with a "not found" page.
      const body = await res.text();
      const soft =
        /page not found|user not found|profile not found|doesn'?t exist|no longer available/i.test(
          body.slice(0, 4000),
        );
      return {
        site: site.name,
        url,
        status: res.status,
        found: soft ? false : true,
        reliability: soft ? "medium" : site.reliability,
      };
    }
    return { site: site.name, url, status: res.status, found: null, reliability: site.reliability };
  } catch {
    return { site: site.name, url, status: "error", found: null, reliability: site.reliability };
  }
}

export async function investigateUsername(raw: string): Promise<ModuleResult> {
  const started = Date.now();
  const username = raw.trim().replace(/^@/, "");
  const sources: SourceRef[] = [{ name: "Direct site probes (curated list)", kind: "public-api" }];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  if (!USERNAME_RE.test(username)) {
    return {
      module: "username",
      target: username,
      durationMs: Date.now() - started,
      sources,
      signals: [{ label: "Username contains unsupported characters", level: "high" }],
      data: { username, valid: false, hits: [] },
      warnings: ["Use 1–64 characters from [a-zA-Z0-9._-]."],
    };
  }

  const hits = await mapLimit(SITES, 6, (site) => probe(site, username));
  const found = hits.filter((h) => h.found === true);
  const absent = hits.filter((h) => h.found === false);
  const unknown = hits.filter((h) => h.found === null);

  if (found.length) {
    signals.push({ label: `Handle exists on ${found.length} of ${SITES.length} checked sites`, level: "info" });
  }
  if (found.length === 0) {
    signals.push({ label: "No profile found on the curated list", level: "low" });
  }
  if (unknown.length > SITES.length / 2) {
    warnings.push(
      `${unknown.length} sites were unreachable or rate-limited. Results are partial — rerun later or check manually.`,
    );
  }
  warnings.push(
    "Absence is not proof of absence: many platforms gate profiles behind login and were not probed deeply.",
  );

  return {
    module: "username",
    target: username,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      username,
      valid: true,
      checked: SITES.length,
      foundCount: found.length,
      absentCount: absent.length,
      unknownCount: unknown.length,
      hits,
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
