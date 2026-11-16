/**
 * Polaris parity — ported from Hamsa's tests/polaris-cctv.test.mjs.
 * The classifier and relay logic moved to OSIRIS when Polaris was removed
 * from the Hamsa console; these tests are the regression net for both.
 */
import { describe, it, expect } from 'vitest';
import { classifyCamera, CCTV_CATEGORIES, type PolarisCamera } from './indonesia-cctv';
import { issueSegmentToken, resolveSegment, rewritePlaylist } from './cctv-relay';

const cam = (parts: Partial<PolarisCamera>): PolarisCamera =>
  ({ id: 'x', name: '', city: '', sourceName: '', ...parts } as PolarisCamera);

describe('classifyCamera', () => {
  it('toll keywords', () => {
    expect(classifyCamera(cam({ id: 'binamarga-tol-1', name: 'A', city: 'B', sourceName: 'S' }))).toBe('toll');
    expect(classifyCamera(cam({ name: 'Jalan Tol Jakarta', sourceName: 'S' }))).toBe('toll');
  });

  it('city via /kota/ and overrides', () => {
    expect(classifyCamera(cam({ name: 'Alun-alun', city: 'Kota Bandung', sourceName: 'S' }))).toBe('city');
    // 'bendungan hilir' is a city (transit stop), not a dam
    expect(classifyCamera(cam({ name: 'Bendungan Hilir', city: 'Jakarta', sourceName: 'S' }))).toBe('city');
  });

  it('mountain requires a volcano word + monitoring hint', () => {
    expect(classifyCamera(cam({ name: 'Pantau Merapi', place: 'Pengamatan', city: 'Kabupaten Sleman', sourceName: 'BPBD' }))).toBe('mountain');
    expect(classifyCamera(cam({ name: 'Jalan Merapi', city: 'Kabupaten X', sourceName: 'S' }))).toBe('other');
  });

  it('dam word-matched, terminal/port substring-matched', () => {
    expect(classifyCamera(cam({ name: 'Waduk Saguling', city: 'Kabupaten X', sourceName: 'S' }))).toBe('dam');
    expect(classifyCamera(cam({ name: 'Terminal Leuwi Panjang', city: 'Kota Bandung', sourceName: 'S' }))).toBe('terminal');
    expect(classifyCamera(cam({ name: 'Pelabuhan Merak', city: 'Kabupaten X', sourceName: 'S' }))).toBe('port');
  });

  it('dam from source name', () => {
    expect(classifyCamera(cam({ name: 'Katulampa', city: 'Kota Bogor', sourceName: 'Pakuan Network · YouTube Live Bendung Katulampa' }))).toBe('dam');
  });

  it('city from source name', () => {
    expect(classifyCamera(cam({ name: 'Sewon', city: 'Kabupaten Bantul', sourceName: 'Dinas Kominfo Gunungkidul' }))).toBe('city');
  });

  it('categories match Phone-X R7 labels', () => {
    expect(CCTV_CATEGORIES.map(c => c.label)).toEqual([
      'SEMUA', 'FAVORIT', 'JALAN TOL', 'KOTA', 'GUNUNG', 'BENDUNGAN', 'TERMINAL', 'PELABUHAN', 'LAINNYA',
    ]);
  });
});

describe('relay', () => {
  it('token: sign + resolve, absolute passthrough', () => {
    const token = issueSegmentToken('https://upstream.example/playlist.m3u8');
    expect(resolveSegment(token, 'seg-1.ts')).toBe('https://upstream.example/seg-1.ts');
    expect(resolveSegment(token, 'https://other.example/x.ts')).toBe('https://other.example/x.ts');
    const bad = token.slice(0, -4) + 'aaaa';
    expect(resolveSegment(bad, 'seg-1.ts')).toBeNull();
  });

  it('rewrites segment lines and leaves tags untouched', () => {
    const token = issueSegmentToken('https://u.example/p.m3u8');
    const out = rewritePlaylist(
      '#EXTM3U\n#EXTINF:10,\nseg1.ts\n#EXT-X-ENDLIST\n',
      token,
      '/api/cctv/relay/bandung/abc',
    );
    const lines = out.split('\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[1]).toBe('#EXTINF:10,');
    expect(lines[2].startsWith('/api/cctv/relay/bandung/abc/segment?t=')).toBe(true);
    expect(lines[2]).toContain('s=seg1.ts');
    expect(lines[3]).toBe('#EXT-X-ENDLIST');
  });
});
