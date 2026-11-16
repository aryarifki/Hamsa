import { describe, expect, it } from 'vitest';
import { fetchIndonesiaCameras } from './indonesia';

describe('fetchIndonesiaCameras', () => {
  it('maps the first playable field in player order', async () => {
    const cams = await fetchIndonesiaCameras();
    const byId = (id: string) => cams.find((c) => c.id === id);

    // relay-hls: Hamsa relay path rewritten to the OSIRIS relay route
    const relay = byId('molecool-official-1001');
    expect(relay?.stream_url).toMatch(/^\/api\/cctv\/relay\/molecool\/1001\/index\.m3u8$/);
    expect(relay?.stream_type).toBe('hls');
    expect(relay?.country).toBe('Indonesia');

    // direct-hls: the portal's own playlist passes through untouched
    const direct = cams.find((c) => c.stream_url?.startsWith('https://dki-jkt.balitower.co.id'));
    expect(direct?.stream_url).toMatch(/index\.m3u8$/);

    // youtube embed: iframe, not hls
    const embed = cams.find((c) => c.stream_url?.includes('youtube.com/embed'));
    expect(embed?.stream_type).toBe('iframe');

    // a Zoneminder snapshot becomes a still feed, not a stream
    const still = cams.find((c) => c.feed_url?.includes('nph-zms'));
    expect(still?.stream_url).toBeUndefined();
    expect(still?.feed_url).toMatch(/^https:\/\//);
  });
});
