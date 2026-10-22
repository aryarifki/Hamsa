import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { runDueWatchlist } from "@/lib/watchlist";
import { safeEqual } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron entrypoint for continuous monitoring.
 *
 * Protect it with CRON_SECRET and call it from systemd-timer, cron, or any
 * scheduler:
 *
 *   curl -s -X POST https://hamsa.example/api/v1/cron/watchlist \
 *        -H "x-cron-secret: $CRON_SECRET"
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return fail(503, "CRON_SECRET is not configured on this deployment");
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!safeEqual(provided, secret)) {
    return fail(401, "Invalid cron secret");
  }

  const summary = await runDueWatchlist(10);
  return ok(summary);
}
