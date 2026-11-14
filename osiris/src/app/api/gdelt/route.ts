import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Real-Time Geopolitical Events (GDELT 2.0 GeoJSON API)
 * Source: GDELT Project — completely free, no auth required
 * Replaces the old RSS scraper with actual GDELT geo-coded events.
 */

// RSS carries its payload XML-escaped, so every GDACS report link arrives as
// report.aspx?eventtype=EQ&amp;eventid=… . That form resolves to a generic
// page — GDACS reads the parameter as "amp;eventid" and serves no event — so
// the entities have to be decoded before the URL is handed to a client.
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

let cachedEvents: any[] = [];
let cachedTime = 0;
const CACHE_TTL = 180_000; // 3 minutes

export async function GET() {
  const now = Date.now();
  if (cachedEvents.length > 0 && now - cachedTime < CACHE_TTL) {
    return NextResponse.json({
      events: cachedEvents,
      total: cachedEvents.length,
      timestamp: new Date(cachedTime).toISOString(),
      source: 'GDACS RSS API (cached)',
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  }

  try {
    const res = await fetch('https://www.gdacs.org/xml/rss.xml', {
      signal: AbortSignal.timeout(4000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (res.ok) {
      const xml = await res.text();
      const rawItems = xml.split(/<item>/i).slice(1);
      const allEvents: any[] = [];
      let eventId = 0;

      for (const rawItem of rawItems) {
        const item = rawItem.split(/<\/item>/i)[0];
        
        const titleMatch = item.match(/<title>(.*?)<\/title>/i) || item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i);
        const linkMatch = item.match(/<link>(.*?)<\/link>/i);
        const descMatch = item.match(/<description>(.*?)<\/description>/i) || item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i);
        const latMatch = item.match(/<geo:lat>(.*?)<\/geo:lat>/i);
        const lngMatch = item.match(/<geo:long>(.*?)<\/geo:long>/i);
        const typeMatch = item.match(/<gdacs:eventtype>(.*?)<\/gdacs:eventtype>/i);

        if (!titleMatch || !latMatch || !lngMatch) continue;

        const title = decodeEntities(titleMatch[1]);
        const link = decodeEntities(linkMatch ? linkMatch[1] : '');
        const desc = decodeEntities(descMatch ? descMatch[1] : '');
        const lat = parseFloat(latMatch[1]);
        const lng = parseFloat(lngMatch[1]);
        const eventType = typeMatch ? typeMatch[1] : 'UNK';

        let type = 'incident';
        if (eventType === 'EQ') type = 'earthquake';
        else if (eventType === 'TC') type = 'weather';
        else if (eventType === 'FL') type = 'flood';
        else if (eventType === 'VO') type = 'volcano';
        else if (eventType === 'WF') type = 'wildfire';
        else if (eventType === 'DR') type = 'drought';

        allEvents.push({
          id: `gdacs-${eventId++}`,
          lat,
          lng,
          name: title,
          url: link,
          html: `<a href="${link}" target="_blank">${title}</a><br/><i>${desc}</i>`,
          type,
        });
      }

      cachedEvents = allEvents;
      cachedTime = now;
    }
  } catch (error) {
    console.warn('[OSIRIS] GDACS fetch error:', error);
  }

  return NextResponse.json({
    events: cachedEvents,
    total: cachedEvents.length,
    timestamp: new Date().toISOString(),
    source: 'GDACS RSS API',
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
