import { NextResponse } from 'next/server';
import { getClientIp, isRateLimited } from '@/lib/ssrf-guard';
import { resolveSegment, fetchUpstream, rewritePlaylist, issueSegmentToken } from '@/lib/cctv-relay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Segment/variant proxy for playlists issued by the relay route. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const ip = getClientIp(request);
  if (isRateLimited(`osiris-cctv-segment:${ip}`, 600, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { slug, id } = await params;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('t');
  const relative = searchParams.get('s');
  if (!token || relative === null) {
    return NextResponse.json({ error: 'Bad segment request' }, { status: 400 });
  }
  const url = resolveSegment(token, relative);
  if (!url) {
    return NextResponse.json({ error: 'Segment token expired or invalid' }, { status: 403 });
  }

  // Playlist variants are rewritten recursively.
  if (url.endsWith('.m3u8') || url.includes('.m3u8?')) {
    const body = await fetchUpstream(url);
    if (!body.ok || !body.text) {
      return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
    }
    const next = issueSegmentToken(url);
    const playlist = rewritePlaylist(body.text, next, `/api/cctv/relay/${slug}/${id}`);
    return new NextResponse(playlist, {
      headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' },
    });
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': 'OSIRIS-Relay/1.0 (https://osirislive.app)' },
  });
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }

  const ctype = res.headers.get('content-type') ?? 'video/mp2t';
  return new NextResponse(res.body, {
    headers: {
      'content-type': ctype.startsWith('video/') ? ctype : 'video/mp2t',
      'cache-control': 'private, max-age=30',
    },
  });
}
