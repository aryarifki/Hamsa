import { describe, it, expect, vi } from 'vitest';
import { issueSegmentToken, resolveSegment, rewritePlaylist } from './cctv-relay';

describe('segment token round-trip', () => {
  it('resolves a relative segment against the token base', () => {
    const token = issueSegmentToken('https://upstream.example/live/cam1/');
    expect(resolveSegment(token, 'seg-1.ts')).toBe('https://upstream.example/live/cam1/seg-1.ts');
  });

  it('accepts an absolute URL as the segment', () => {
    const token = issueSegmentToken('https://upstream.example/live/cam1/index.m3u8');
    expect(resolveSegment(token, 'https://cdn.example/seg/2.ts')).toBe('https://cdn.example/seg/2.ts');
  });

  it('rejects a signature without a valid HMAC pair', () => {
    const token = issueSegmentToken('https://upstream.example/');
    expect(resolveSegment(`${token}.tampered`, 'x.ts')).toBeNull();
    expect(resolveSegment('no-signature-here', 'x.ts')).toBeNull();
  });
});

describe('rewritePlaylist', () => {
  it('rewrites segment lines as relay-proxy URLs and leaves tags alone', () => {
    const token = issueSegmentToken('https://upstream.example/');
    const out = rewritePlaylist(
      '#EXTM3U\n#EXT-X-TARGETDURATION:6\nseg1.ts\n#EXTINF:6,\nseg2.ts\n',
      token,
      '/api/cctv/relay/depok/123',
    );
    const lines = out.split('\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[2]).toContain('/api/cctv/relay/depok/123/segment?t=');
    expect(lines[2]).toContain('s=seg1.ts');
    expect(lines[4]).toContain('s=seg2.ts');
  });
});

describe('fetchUpstream failure handling', () => {
  it('returns 502 rather than throwing on an unreachable host', async () => {
    const { fetchUpstream } = await import('./cctv-relay');
    const res = await fetchUpstream('http://127.0.0.1:9/nothing-here');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
  });
});
