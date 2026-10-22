const DEFAULT_UA =
  "Hamsa-OSINT/1.0 (+https://github.com/aryarifki/Hamsa; authorized-investigation-tool)";

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

export class FetchTimeout extends Error {
  constructor(url: string, ms: number) {
    super(`Request to ${url} timed out after ${ms}ms`);
    this.name = "FetchTimeout";
  }
}

/**
 * fetch with a hard timeout and a stable User-Agent.
 *
 * Every outbound call in Hamsa goes through here so that (a) a dead provider
 * cannot hang a request, and (b) the tool identifies itself honestly instead of
 * impersonating a browser.
 */
export async function fetchJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 8000, headers = {}, method = "GET", body } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      body,
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "application/json",
        ...headers,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Upstream ${res.status} ${res.statusText} for ${new URL(url).host}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new FetchTimeout(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 8000, headers = {} } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": DEFAULT_UA, ...headers },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Upstream ${res.status} for ${new URL(url).host}`);
    return await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new FetchTimeout(url, timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs an array of promise factories with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
