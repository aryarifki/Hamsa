/**
 * Fixed-window, in-process rate limiter.
 *
 * Deliberately not Redis-backed: Hamsa ships as a single-node deployment, and
 * an in-memory map is enough to blunt credential stuffing and provider abuse.
 * If you scale horizontally, replace the store with Redis — the interface is
 * intentionally tiny.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const nowMs = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= nowMs) {
    if (buckets.size > MAX_KEYS) {
      for (const [k, b] of buckets) if (b.resetAt <= nowMs) buckets.delete(k);
    }
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((existing.resetAt - nowMs) / 1000) };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfter: 0 };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
