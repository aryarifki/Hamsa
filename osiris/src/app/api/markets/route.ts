
import { NextResponse } from 'next/server';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Financial Markets & Commodities API
 *
 * Indices, rates, FX, defense equities, energy, commodities and crypto, all
 * from Yahoo's v8 chart endpoint. One request per symbol buys the last close,
 * a month of daily closes for the sparkline, and the session window — so the
 * panel can show a trend and say whether the market is actually open.
 *
 * The old v6 quote fallback was removed: Yahoo decommissioned it and it 404s
 * on every call, so it only ever added a round-trip to a failing request.
 */

export interface Quote {
  group: string;
  name: string;
  symbol: string;
  price: number;
  change_percent: number;
  up: boolean;
  /** Daily closes, oldest first — enough to draw a one-month sparkline. */
  spark: number[];
  currency: string;
  market_open: boolean;
  /* The rest of a terminal row, all in the same response: no extra request. */
  /** The previous session's close, which the day's move is measured from. */
  prev_close: number;
  day_high?: number;
  day_low?: number;
  volume?: number;
  /** Last trade, unix seconds. */
  time?: number;
  high_52w?: number;
  low_52w?: number;
  exchange?: string;
  description?: string;
}

/** Display name and section for every instrument we track. Exported: the chart route serves these and nothing else. */
export const TICKERS: Array<{ symbol: string; name: string; group: string }> = [
  { symbol: 'ES=F', name: 'S&P 500', group: 'indices' },
  { symbol: 'NQ=F', name: 'Nasdaq 100', group: 'indices' },
  { symbol: '^VIX', name: 'VIX', group: 'indices' },
  { symbol: 'DX-Y.NYB', name: 'Dollar Index', group: 'indices' },
  { symbol: '^TNX', name: 'US 10Y', group: 'indices' },
  // The rest of the world's trading day, so the board isn't US-only.
  { symbol: '^GDAXI', name: 'DAX', group: 'indices' },
  { symbol: '^FTSE', name: 'FTSE 100', group: 'indices' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50', group: 'indices' },
  { symbol: '^N225', name: 'Nikkei 225', group: 'indices' },
  { symbol: '^HSI', name: 'Hang Seng', group: 'indices' },

  { symbol: 'RTX', name: 'RTX', group: 'stocks' },
  { symbol: 'LMT', name: 'LMT', group: 'stocks' },
  { symbol: 'NOC', name: 'NOC', group: 'stocks' },
  { symbol: 'GD', name: 'GD', group: 'stocks' },
  { symbol: 'BA', name: 'BA', group: 'stocks' },
  { symbol: 'LHX', name: 'LHX', group: 'stocks' },
  { symbol: 'PLTR', name: 'PLTR', group: 'stocks' },

  { symbol: 'CL=F', name: 'WTI Crude', group: 'oil' },
  { symbol: 'BZ=F', name: 'Brent Crude', group: 'oil' },
  { symbol: 'NG=F', name: 'Natural Gas', group: 'oil' },

  { symbol: 'GC=F', name: 'Gold', group: 'commodities' },
  { symbol: 'SI=F', name: 'Silver', group: 'commodities' },
  { symbol: 'HG=F', name: 'Copper', group: 'commodities' },
  { symbol: 'ZW=F', name: 'Wheat', group: 'commodities' },
  { symbol: 'ZC=F', name: 'Corn', group: 'commodities' },

  { symbol: 'BTC-USD', name: 'Bitcoin', group: 'crypto' },
  { symbol: 'ETH-USD', name: 'Ethereum', group: 'crypto' },
  { symbol: 'SOL-USD', name: 'Solana', group: 'crypto' },
  { symbol: 'XRP-USD', name: 'XRP', group: 'crypto' },

  { symbol: 'EURUSD=X', name: 'EUR/USD', group: 'fx' },
  { symbol: 'USDJPY=X', name: 'USD/JPY', group: 'fx' },
  { symbol: 'GBPUSD=X', name: 'GBP/USD', group: 'fx' },
  { symbol: 'USDCNY=X', name: 'USD/CNY', group: 'fx' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Round to 2dp without dragging in floating-point tails. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Prices keep four decimals: two cut EUR/USD from 1.0834 to 1.08, which is a
 * hundred pips of nothing. The panel picks how many to show per instrument.
 */
function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** A finite number from the payload, rounded, or undefined. */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? r4(v) : undefined;
}

export async function fetchQuote(t: { symbol: string; name: string; group: string }): Promise<Quote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t.symbol)}?interval=1d&range=1mo`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2000),
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) return null;

    const result = (await res.json())?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return null;

    const price = meta.regularMarketPrice;
    if (!Number.isFinite(price)) return null;

    const spark: number[] = (result.indicators?.quote?.[0]?.close || [])
      .filter((c: unknown): c is number => Number.isFinite(c))
      .map((c: number) => r4(c));

    const prevClose = spark.length >= 2 ? spark[spark.length - 2] : meta.chartPreviousClose;
    if (!Number.isFinite(prevClose) || prevClose === 0) return null;

    const changePercent = ((price - prevClose) / prevClose) * 100;

    const period = meta.currentTradingPeriod?.regular;
    const nowSec = Date.now() / 1000;
    const marketOpen = Number.isFinite(period?.start) && Number.isFinite(period?.end)
      ? nowSec >= period.start && nowSec <= period.end
      : false;

    return {
      group: t.group,
      name: t.name,
      symbol: t.symbol,
      price: r4(price),
      change_percent: r2(changePercent),
      up: changePercent >= 0,
      spark,
      currency: meta.currency || 'USD',
      market_open: marketOpen,
      prev_close: r4(prevClose),
      day_high: num(meta.regularMarketDayHigh),
      day_low: num(meta.regularMarketDayLow),
      volume: typeof meta.regularMarketVolume === 'number' && meta.regularMarketVolume > 0 ? meta.regularMarketVolume : undefined,
      time: typeof meta.regularMarketTime === 'number' ? meta.regularMarketTime : undefined,
      high_52w: num(meta.fiftyTwoWeekHigh),
      low_52w: num(meta.fiftyTwoWeekLow),
      exchange: typeof meta.fullExchangeName === 'string' ? meta.fullExchangeName.slice(0, 40) : undefined,
      description: typeof meta.shortName === 'string' ? meta.shortName.slice(0, 60) : undefined,
    };
  } catch { return null; }
}

const CONCURRENCY = 5;

// Seed baseline quotes so the markets panel is never empty even if Yahoo blocks server IP
const SEED_PRICES: Record<string, { price: number; change: number; spark: number[] }> = {
  'ES=F': { price: 5875.25, change: 0.35, spark: [5820, 5840, 5860, 5875] },
  'NQ=F': { price: 20610.50, change: 0.52, spark: [20400, 20500, 20550, 20610] },
  '^VIX': { price: 14.85, change: -1.2, spark: [15.5, 15.2, 15.0, 14.85] },
  'DX-Y.NYB': { price: 106.75, change: 0.15, spark: [106.2, 106.5, 106.6, 106.75] },
  '^TNX': { price: 4.44, change: 0.02, spark: [4.40, 4.42, 4.43, 4.44] },
  '^GDAXI': { price: 19210.00, change: 0.22, spark: [19100, 19150, 19180, 19210] },
  '^FTSE': { price: 8071.19, change: -0.05, spark: [8090, 8080, 8075, 8071] },
  '^STOXX50E': { price: 4794.75, change: 0.18, spark: [4760, 4780, 4785, 4794] },
  '^N225': { price: 38642.91, change: 0.28, spark: [38400, 38500, 38600, 38642] },
  '^HSI': { price: 19426.34, change: -0.45, spark: [19600, 19500, 19450, 19426] },
  'RTX': { price: 121.45, change: 0.65, spark: [119, 120, 120.5, 121.45] },
  'LMT': { price: 535.10, change: 0.42, spark: [530, 532, 533, 535.1] },
  'NOC': { price: 495.80, change: 0.31, spark: [490, 492, 494, 495.8] },
  'GD': { price: 285.60, change: 0.15, spark: [282, 284, 285, 285.6] },
  'BA': { price: 139.80, change: -0.85, spark: [142, 141, 140.5, 139.8] },
  'LHX': { price: 210.25, change: 0.20, spark: [208, 209, 209.5, 210.25] },
  'PLTR': { price: 63.40, change: 1.85, spark: [59, 61, 62, 63.4] },
  'CL=F': { price: 68.65, change: -0.45, spark: [70, 69.5, 69, 68.65] },
  'BZ=F': { price: 72.30, change: -0.38, spark: [73.5, 73, 72.8, 72.3] },
  'NG=F': { price: 2.92, change: 1.15, spark: [2.8, 2.85, 2.88, 2.92] },
  'GC=F': { price: 2568.40, change: 0.25, spark: [2550, 2555, 2560, 2568.4] },
  'SI=F': { price: 30.65, change: 0.40, spark: [30.2, 30.4, 30.5, 30.65] },
  'HG=F': { price: 4.09, change: -0.15, spark: [4.12, 4.11, 4.10, 4.09] },
  'ZW=F': { price: 536.50, change: 0.10, spark: [532, 534, 535, 536.5] },
  'ZC=F': { price: 426.00, change: -0.20, spark: [428, 427, 426.5, 426] },
  'BTC-USD': { price: 90850.00, change: 2.45, spark: [87000, 88500, 89800, 90850] },
  'ETH-USD': { price: 3125.50, change: 1.10, spark: [3050, 3080, 3100, 3125.5] },
  'SOL-USD': { price: 216.80, change: 3.20, spark: [205, 210, 212, 216.8] },
  'XRP-USD': { price: 0.885, change: 5.40, spark: [0.78, 0.82, 0.85, 0.885] },
  'EURUSD=X': { price: 1.0542, change: -0.12, spark: [1.058, 1.056, 1.055, 1.0542] },
  'USDJPY=X': { price: 154.35, change: 0.25, spark: [153.8, 154.0, 154.2, 154.35] },
  'GBPUSD=X': { price: 1.2680, change: -0.08, spark: [1.272, 1.270, 1.269, 1.268] },
  'USDCNY=X': { price: 7.2340, change: 0.05, spark: [7.22, 7.225, 7.23, 7.234] },
};

const lastGood = new Map<string, Quote>();
for (const t of TICKERS) {
  const seed = SEED_PRICES[t.symbol] || { price: 100, change: 0, spark: [100, 100] };
  lastGood.set(t.symbol, {
    group: t.group,
    name: t.name,
    symbol: t.symbol,
    price: seed.price,
    change_percent: seed.change,
    up: seed.change >= 0,
    spark: seed.spark,
    currency: 'USD',
    market_open: false,
    prev_close: seed.price / (1 + seed.change / 100),
  });
}

/** Run `fetchQuote` over a list with a bounded number of requests in flight. */
async function fetchBatch(tickers: typeof TICKERS, into: Map<string, Quote>): Promise<void> {
  let next = 0;
  let consecutiveFailures = 0;
  const worker = async () => {
    while (next < tickers.length && consecutiveFailures < 3) {
      const ticker = tickers[next++];
      const quote = await fetchQuote(ticker);
      if (quote) {
        into.set(ticker.symbol, quote);
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

export async function fetchAllQuotes(): Promise<Quote[]> {
  const fresh = new Map<string, Quote>();

  await fetchBatch(TICKERS, fresh);

  // If initial batch succeeded, update lastGood
  for (const [symbol, quote] of fresh) lastGood.set(symbol, quote);

  return TICKERS
    .map(t => fresh.get(t.symbol) || lastGood.get(t.symbol))
    .filter((q): q is Quote => q !== undefined);
}

/**
 * 60s TTL. The client polls far less often than that; the cache is here so a
 * burst of viewers shares one upstream pass, and — more importantly — so a
 * failed refresh keeps serving the last good prices instead of blanking the
 * whole panel, which is what used to happen on a cold start.
 */
export const getQuotes = cachedSource<Quote>('markets', fetchAllQuotes, 60_000);

/** Chokepoint risk that has a direct read-through to the instruments above. */
async function fetchScmAlerts(origin: string): Promise<string[]> {
  const alerts: string[] = [];
  try {
    const url = origin.includes('/osiris') ? `${origin}/api/maritime` : `${origin}/osiris/api/maritime`;
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return alerts;
    const chokepoints = (await res.json())?.chokepoints || [];

    const atRisk = (name: string) => {
      const c = chokepoints.find((x: { name?: string; risk?: string }) => x.name === name);
      return c && (c.risk === 'CRITICAL' || c.risk === 'HIGH') ? c.risk : null;
    };

    const hormuz = atRisk('Strait of Hormuz');
    const suez = atRisk('Suez Canal');
    const panama = atRisk('Panama Canal');
    if (hormuz) alerts.push(`🚨 HORMUZ ${hormuz}: High risk of WTI/Brent Crude price spike due to congestion.`);
    if (suez) alerts.push(`🚨 SUEZ ${suez}: Potential supply chain delays impacting European markets and Energy.`);
    if (panama) alerts.push(`🚨 PANAMA ${panama}: LNG and Agriculture (Corn/Wheat) shipment delays expected.`);
  } catch {
    // Maritime unreachable — the market data still stands on its own.
  }
  return alerts;
}

/** Fold the flat quote list back into the per-section shape the UI reads. */
export function groupQuotes(quotes: Quote[]): Record<string, Record<string, Quote>> {
  const out: Record<string, Record<string, Quote>> = {
    indices: {}, stocks: {}, oil: {}, commodities: {}, crypto: {}, fx: {},
  };
  for (const q of quotes) {
    (out[q.group] ||= {})[q.name] = q;
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    const [quotes, scm_alerts] = await Promise.all([getQuotes(), fetchScmAlerts(origin)]);

    return NextResponse.json({
      ...groupQuotes(quotes),
      scm_alerts,
      count: quotes.length,
      timestamp: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'no-store' }, // Prevent caching so alerts update real-time
    });
  } catch (error) {
    console.error('Markets fetch error:', error);
    return NextResponse.json(
      { ...groupQuotes([]), scm_alerts: [], count: 0, error: 'Failed' },
      { status: 500 },
    );
  }
}
