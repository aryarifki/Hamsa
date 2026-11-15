import { NextRequest, NextResponse } from "next/server";
import { fail, requireAuth, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { runtimeCameraById, relayUpstream } from "@/lib/polaris/cctv-server";
import { fetchUpstream, issueSegmentToken, rewritePlaylist } from "@/lib/polaris/cctv-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hamsa relay for hidden-upstream CCTV playlists (bandung, depok).
 *
 * Hidden-portal slugs (molecool, tangerang, banyuwangi, malangkota) resolve to
 * no upstream and return the same `upstream_unavailable` failure Phone-X
 * returns — never a fabricated playlist.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    enforceRate(req, `osiris-cctv-relay:${user.id}`, 120, 60_000);

    const { slug, id } = await params;
    const camera = runtimeCameraById(slug, id);
    const upstream = relayUpstream(slug, camera);
    if (!upstream) {
      return fail(502, "upstream_unavailable", { code: "upstream_unavailable", slug });
    }

    const body = await fetchUpstream(upstream);
    if (!body.ok || !body.text) {
      return fail(502, "upstream_unavailable", { code: "upstream_unavailable", slug, upstreamStatus: body.status });
    }

    const token = issueSegmentToken(upstream);
    const playlist = rewritePlaylist(body.text, token, `/api/v1/osiris/cctv/${slug}/${id}`);
    return new NextResponse(playlist, {
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] cctv relay failed", err);
    return fail(502, "Relay unavailable");
  }
}
