import { NextRequest, NextResponse } from "next/server";
import { fail, requireAuth, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { cameraById, capturePublicFrame } from "@/lib/cctv/public-feeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One JPEG frame from a configured public feed.
 *
 * Frames are pulled server-side so the upstream stream URL (which may contain a
 * token) never reaches the browser. Nothing is cached on disk.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ city: string; id: string }> },
) {
  try {
    const { user } = await requireAuth(req);
    enforceRate(req, `osiris-cctv:${user.id}`, 40, 60_000);

    const { city, id } = await params;
    const match = cameraById(city, id);
    if (!match) return fail(404, "Camera not found");
    if (!match.camera.streamUrl) {
      return fail(503, `No stream configured for ${match.city.name}`, {
        code: "FEED_UNAVAILABLE",
        envKey: match.city.envKey,
      });
    }

    const frame = await capturePublicFrame(match.camera.streamUrl);
    if (!frame.ok || !frame.body) {
      return fail(frame.status, "Frame could not be captured", {
        code: "FRAME_FAILED",
        warning: frame.warning,
      });
    }

    return new NextResponse(new Uint8Array(frame.body), {
      headers: {
        "content-type": frame.contentType,
        "content-length": String(frame.body.length),
        "cache-control": "private, max-age=10",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] cctv frame failed", err);
    return fail(502, "Frame unavailable");
  }
}
