
import { NextResponse } from 'next/server';

/**
 * OSIRIS — Earthquake Data API
 * Fetches real-time seismic events from USGS (last 24h, M2.5+)
 * No API key required
 */

let cachedData: any[] = [];
let cachedTime = 0;
const CACHE_TTL = 120_000; // 2 minutes

export async function GET() {
  const now = Date.now();
  if (cachedData.length > 0 && now - cachedTime < CACHE_TTL) {
    return NextResponse.json({
      earthquakes: cachedData,
      total: cachedData.length,
      timestamp: new Date(cachedTime).toISOString(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  }

  try {
    const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json();
      const features = data.features || [];

      cachedData = features.map((f: any) => {
        const coords = f.geometry?.coordinates || [0, 0, 0];
        const props = f.properties || {};
        return {
          id: f.id,
          lat: coords[1],
          lng: coords[0],
          depth: coords[2],
          magnitude: props.mag,
          place: props.place,
          time: props.time,
          url: props.url,
          tsunami: props.tsunami,
          type: props.type,
          felt: props.felt,
          alert: props.alert,
        };
      });
      cachedTime = now;
    }
  } catch (error) {
    console.warn('Earthquake fetch error:', error);
  }

  return NextResponse.json({
    earthquakes: cachedData,
    total: cachedData.length,
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
    },
  });
}

