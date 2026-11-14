import { fetchText } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

/**
 * Telegram channel analytics on top of the public web preview.
 *
 * Reads only what `t.me/s/<channel>` already serves anonymously: subscriber
 * count, the window of posts shown, view counters and post dates. No account,
 * no MTProto session and no message history beyond the public preview page.
 */

const CHANNEL_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

export interface AnalyticsPost {
  id: string;
  url: string;
  datetime: string | null;
  views: number | null;
  text: string;
}

function parseViews(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s/g, "").replace(",", ".").toUpperCase();
  const match = /^([\d.]+)([KM]?)$/.exec(cleaned);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  if (match[2] === "K") return Math.round(base * 1_000);
  if (match[2] === "M") return Math.round(base * 1_000_000);
  return Math.round(base);
}

const stripHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

export async function investigateTelegramAnalytics(channel: string): Promise<ModuleResult> {
  const started = Date.now();
  const name = channel.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\/(s\/)?/, "");
  const sources: SourceRef[] = [{ name: "t.me public web preview", kind: "public-api" }];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  if (!CHANNEL_RE.test(name)) {
    return {
      module: "telegram-analytics",
      target: name,
      durationMs: Date.now() - started,
      sources,
      signals: [{ label: "Invalid public channel name", level: "high" }],
      data: { channel: name, valid: false },
      warnings: ["Use 5–32 characters: letters, digits and underscores."],
    };
  }

  const html = await fetchText(`https://t.me/s/${encodeURIComponent(name)}`, { timeoutMs: 10_000 });
  const subscriberMatch =
    /class="tgme_page_extra"[^>]*>\s*([\d\s.,]+)\s*(?:subscribers|member|anggota)/i.exec(html) ??
    /([\d\s.,]+)\s*(?:subscribers|members)/i.exec(html);
  const subscriberCount = subscriberMatch ? Number(subscriberMatch[1].replace(/[^\d]/g, "")) || null : null;

  const title = /<meta property="og:title" content="([^"]+)"/.exec(html)?.[1] ?? name;
  const description = /<meta property="og:description" content="([^"]+)"/.exec(html)?.[1] ?? null;

  const chunks = html.split('class="tgme_widget_message_wrap').slice(1);
  const posts: AnalyticsPost[] = [];
  for (const chunk of chunks) {
    const id = /data-post="([^"]+)"/.exec(chunk)?.[1] ?? "";
    const datetime = /<time[^>]+datetime="([^"]+)"/.exec(chunk)?.[1] ?? null;
    const viewsRaw = /class="tgme_widget_message_views">([^<]+)</.exec(chunk)?.[1];
    const textMatch = /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(chunk);
    posts.push({
      id,
      url: id ? `https://t.me/${id}` : `https://t.me/s/${name}`,
      datetime,
      views: parseViews(viewsRaw),
      text: textMatch ? stripHtml(textMatch[1]).slice(0, 600) : "",
    });
  }

  const dated = posts.filter((p) => p.datetime).map((p) => Date.parse(p.datetime!)).filter(Number.isFinite);
  const spanDays = dated.length > 1 ? (Math.max(...dated) - Math.min(...dated)) / 86_400_000 : 0;
  const messageRate = spanDays > 0 ? Number((posts.length / spanDays).toFixed(2)) : null;

  const withViews = posts.filter((p) => typeof p.views === "number") as Array<AnalyticsPost & { views: number }>;
  const avgViews = withViews.length
    ? Math.round(withViews.reduce((sum, p) => sum + p.views, 0) / withViews.length)
    : null;
  const topPosts = [...withViews].sort((a, b) => b.views - a.views).slice(0, 5);

  if (!posts.length) {
    warnings.push("No public posts were rendered. The channel may be private, empty, or the preview may be blocked.");
    signals.push({ label: "Public preview returned no posts", level: "low" });
  } else {
    signals.push({ label: `${posts.length} public post(s) in the preview window`, level: "info" });
  }
  if (subscriberCount) signals.push({ label: `${subscriberCount.toLocaleString()} subscribers`, level: "info" });
  if (messageRate !== null) signals.push({ label: `≈${messageRate} post(s) per day`, level: "info" });
  if (avgViews !== null) signals.push({ label: `Average ${avgViews.toLocaleString()} views per post`, level: "info" });
  if (subscriberCount && avgViews && avgViews > 0 && subscriberCount / avgViews > 50) {
    signals.push({ label: "High subscriber-to-view ratio — engagement looks inflated", level: "medium" });
  }

  return {
    module: "telegram-analytics",
    target: name,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      channel: name,
      valid: true,
      title,
      description,
      subscriberCount,
      postsInPreview: posts.length,
      messageRate,
      avgViews,
      topPosts,
      posts: posts.slice(0, 30),
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
