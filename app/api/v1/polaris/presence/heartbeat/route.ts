import { NextRequest } from "next/server";
import { clientIp, fail, ok } from "@/lib/http";
import { enforceRate } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polaris presence heartbeat (Phone-X parity).
 *
 * Phone-X POSTs `{visitorId}` every 25 s while the dashboard is visible and
 * renders `{activeVisitors}` ("pengunjung online", 90-second window). Hamsa
 * keeps the same wire shape in memory: no persistence, one server process,
 * visitors expire after 90 s. Same-browser tabs collapse to one UUID because
 * the id lives in localStorage.
 */

const WINDOW_MS = 90_000;
const SWEEP_MS = 10_000;

const visitors = new Map<string, number>();
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_MS) return;
  lastSweep = now;
  for (const [id, seenAt] of visitors) {
    if (now - seenAt > WINDOW_MS) visitors.delete(id);
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    enforceRate(req, `polaris-presence:${clientIp(req)}`, 40, 60_000);
  } catch {
    // Silently report zero rather than erroring the dashboard poller.
    return ok({ activeVisitors: 0 });
  }

  let visitorId: unknown;
  try {
    ({ visitorId } = await req.json());
  } catch {
    return fail(400, "Invalid body");
  }
  if (typeof visitorId !== "string" || !UUID_RE.test(visitorId)) {
    return fail(400, "Invalid visitorId");
  }

  const now = Date.now();
  sweep(now);
  visitors.set(visitorId, now);
  return ok({ activeVisitors: visitors.size });
}
