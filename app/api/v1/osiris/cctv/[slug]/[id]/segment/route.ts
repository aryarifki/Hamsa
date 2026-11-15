import { NextRequest, NextResponse } from "next/server";
import { fail, requireAuth, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { resolveSegment, fetchUpstream, rewritePlaylist, issueSegmentToken } from "@/lib/polaris/cctv-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Segment/variant proxy for playlists issued by the relay route. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    enforceRate(req, `osiris-cctv-segment:${user.id}`, 600, 60_000);

    const { slug, id } = await params;
    const token = req.nextUrl.searchParams.get("t");
    const relative = req.nextUrl.searchParams.get("s");
    if (!token || relative === null) return fail(400, "Bad segment request");
    const url = resolveSegment(token, relative);
    if (!url) return fail(403, "Segment token expired or invalid");

    // Playlist variants are rewritten recursively.
    if (url.endsWith(".m3u8") || url.includes(".m3u8?")) {
      const body = await fetchUpstream(url);
      if (!body.ok || !body.text) return fail(502, "upstream_unavailable");
      const next = issueSegmentToken(url);
      const playlist = rewritePlaylist(body.text, next, `/api/v1/osiris/cctv/${slug}/${id}`);
      return new NextResponse(playlist, {
        headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" },
      });
    }

    const res = await fetch(url, {
      headers: { "User-Agent": "Hamsa-Polaris/1.0 (+https://hamsa.avenia.my.id)" },
    });
    if (!res.ok || !res.body) return fail(502, "upstream_unavailable");

    const ctype = res.headers.get("content-type") ?? "video/mp2t";
    return new NextResponse(res.body, {
      headers: {
        "content-type": ctype.startsWith("video/") ? ctype : "video/mp2t",
        "cache-control": "private, max-age=30",
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] cctv segment failed", err);
    return fail(502, "Segment unavailable");
  }
}
