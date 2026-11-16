import { NextResponse } from 'next/server';
import { getClientIp, isRateLimited } from '@/lib/ssrf-guard';
import { runtimeCameraById, relayUpstream } from '@/lib/indonesia-cctv';
import { fetchUpstream, issueSegmentToken, rewritePlaylist } from '@/lib/cctv-relay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OSIRIS relay for hidden-upstream Indonesian CCTV playlists (bandung, depok).
 *
 * Ported from Hamsa. Hidden-portal slugs (molecool, tangerang, banyuwangi,
 * malangkota) resolve to no upstream and return the same
 * `upstream_unavailable` failure Phone-X returns — never a fabricated
 * playlist.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const ip = getClientIp(request);
  if (isRateLimited(`osiris-cctv-relay:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { slug, id } = await params;
  const camera = runtimeCameraById(slug, id);
  const upstream = relayUpstream(slug, camera);
  if (!upstream) {
    return NextResponse.json({ error: 'upstream_unavailable', code: 'upstream_unavailable', slug }, { status: 502 });
  }

  const body = await fetchUpstream(upstream);
  if (!body.ok || !body.text) {
    return NextResponse.json(
      { error: 'upstream_unavailable', code: 'upstream_unavailable', slug, upstreamStatus: body.status },
      { status: 502 },
    );
  }

  const token = issueSegmentToken(upstream);
  const playlist = rewritePlaylist(body.text, token, `/api/cctv/relay/${slug}/${id}`);
  return new NextResponse(playlist, {
    headers: {
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
