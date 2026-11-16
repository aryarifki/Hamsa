import type { CctvCamera } from './types';
import { indonesiaCameras, type PolarisCamera } from '@/lib/indonesia-cctv';

/**
 * OSIRIS — Indonesian public CCTV (Polaris parity).
 *
 * The cameras Hamsa's Polaris panel bundled — 5,355 valid ones across nine
 * category keywords — served first-party: the relay routes under
 * /api/cctv/relay for the portals whose upstreams this server fetches
 * (depok, bandung), direct HLS for the portals that publish it, and the rest
 * carrying no playable stream, which the player surfaces as a failure state
 * exactly as Phone-X did. This region is the authoritative index for the
 * country: opencctv's republished Indonesian rows are dropped in favour of it.
 */
export async function fetchIndonesiaCameras(): Promise<CctvCamera[]> {
  return indonesiaCameras().map(toOsirisCamera);
}

/** PolarisCamera → CctvCamera: the first playable field wins, in player order. */
function toOsirisCamera(cam: PolarisCamera): CctvCamera {
  const camera: CctvCamera = {
    id: cam.id,
    lat: cam.lat,
    lng: cam.lng,
    name: cam.name,
    city: cam.city,
    country: 'Indonesia',
    source: cam.sourceName,
  };

  const relay = cam.relayPlaylistUrl?.replace('/api/osiris/cctv/', '/api/cctv/relay/');
  if (relay) {
    camera.stream_url = relay;
    camera.stream_type = 'hls';
  } else if (cam.directPlaylistUrl) {
    camera.stream_url = cam.directPlaylistUrl;
    camera.stream_type = 'hls';
  } else if (cam.streamUrl) {
    camera.stream_url = cam.streamUrl;
    camera.stream_type = 'hls';
  } else if (cam.embedUrl) {
    camera.stream_url = cam.embedUrl;
    camera.stream_type = 'iframe';
  } else if (cam.publishedStreamUrl) {
    camera.feed_url = cam.publishedStreamUrl;
  }

  return camera;
}
