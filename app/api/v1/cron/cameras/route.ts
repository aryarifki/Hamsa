import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { safeEqual } from "@/lib/crypto";
import { pruneSnapshots, runDueCameras } from "@/lib/cctv/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron entrypoint for the camera scheduler.
 *
 *   curl -fsS -X POST https://hamsa.example/api/v1/cron/cameras \
 *        -H "x-cron-secret: $CRON_SECRET"
 *
 * The `Authorization: Bearer` form is accepted as well. Each pass is bounded:
 * at most `HAMSA_CAMERA_BATCH` cameras (default 5) whose interval has elapsed,
 * followed by a retention prune of snapshot metadata.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return fail(503, "CRON_SECRET is not configured on this deployment");
  }

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const provided = req.headers.get("x-cron-secret") || bearer;
  if (!safeEqual(provided, secret)) {
    return fail(401, "Invalid cron secret");
  }

  const batch = Math.min(25, Math.max(1, Number(process.env.HAMSA_CAMERA_BATCH ?? 5)));
  const cameras = await runDueCameras(batch);

  const retention = Math.max(1, Number(process.env.HAMSA_SNAPSHOT_RETENTION_DAYS ?? 14));
  const pruned = await pruneSnapshots(retention);

  return ok({ ...cameras, pruned });
}
