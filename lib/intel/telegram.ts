import { fetchText } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

const CHANNEL_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

export interface TelegramPost {
  id: string;
  channel: string;
  url: string;
  datetime: string | null;
  text: string;
  matched: boolean;
}

const stripHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

/**
 * Reads a public channel's web preview (t.me/s/<channel>), which Telegram serves
 * to anonymous visitors. No account, token or API key is involved, and only
 * content the channel already publishes publicly is read.
 */
export async function searchPublicChannel(
  channel: string,
  keyword: string,
  limit = 20,
): Promise<TelegramPost[]> {
  const name = channel.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\/(s\/)?/, "");
  if (!CHANNEL_RE.test(name)) throw new Error("Invalid public channel name");

  const html = await fetchText(`https://t.me/s/${encodeURIComponent(name)}`, { timeoutMs: 9000 });
  const chunks = html.split('class="tgme_widget_message_wrap').slice(1);
  const needle = keyword.trim().toLowerCase();
  const posts: TelegramPost[] = [];

  for (const chunk of chunks) {
    const id = /data-post="([^"]+)"/.exec(chunk)?.[1] ?? "";
    const dateTime = /<time[^>]+datetime="([^"]+)"/.exec(chunk)?.[1] ?? null;
    const textMatch = /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(chunk);
    if (!textMatch) continue;

    const text = stripHtml(textMatch[1]);
    if (!text) continue;

    const matched = needle.length === 0 || text.toLowerCase().includes(needle);
    if (!matched) continue;

    posts.push({
      id,
      channel: name,
      url: id ? `https://t.me/${id}` : `https://t.me/s/${name}`,
      datetime: dateTime,
      text: text.slice(0, 1200),
      matched,
    });
    if (posts.length >= limit) break;
  }

  return posts;
}

export async function investigateTelegram(
  channel: string,
  keyword: string,
): Promise<ModuleResult> {
  const started = Date.now();
  const sources: SourceRef[] = [{ name: "t.me public web preview", kind: "public-api" }];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  let posts: TelegramPost[] = [];
  try {
    posts = await searchPublicChannel(channel, keyword, 25);
  } catch (err) {
    warnings.push(`Channel could not be read: ${(err as Error).message}`);
  }

  if (posts.length === 0) {
    signals.push({ label: "No matching public posts retrieved", level: "low" });
    warnings.push(
      "Only channels with a public preview are readable. Private channels, groups and bots are out of scope by design.",
    );
  } else {
    signals.push({ label: `${posts.length} matching public post(s)`, level: "info" });
  }

  return {
    module: "telegram",
    target: channel,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      channel: channel.replace(/^@/, ""),
      keyword,
      count: posts.length,
      posts,
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
