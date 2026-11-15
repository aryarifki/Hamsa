"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { type Map as MaplibreMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  DEFAULT_UI,
  loadFavorites,
  loadUi,
  saveFavorites,
  saveUi,
  useFeeds,
  usePresence,
  type Basemap,
  type HazardState,
  type LayerState,
  type PreviewState,
  type SituationItem,
  type UiSettings,
  type ViewMode,
} from "./data";
import {
  FlightsPanel,
  HazardsPanel,
  MaintenancePanel,
  OnlineCount,
  SpacePanel,
  TickerDetail,
  UnavailablePanel,
  type FlightScope,
} from "./panels";
import type { CategoryKey } from "@/lib/polaris/cctv";
import { categoryCounts, filterCameras, useCctvCameras } from "./cctv-data";
import { CctvCategoryPanel, CctvViewer, PreviewPopup, type PopupSelection } from "./cctv-panel";
import { CctvMapLayer } from "./cctv-layer";

/**
 * Polaris dashboard (Phone-X parity): full-viewport MapLibre map, tool rail,
 * mode switcher (3D/2D + MAP/SAT), hazard/flight/space/CCTV panels, news
 * ticker, quake bottom ticker, presence counter and cursor readout. All data
 * comes from Hamsa's own endpoints.
 */

const DARK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "carto-dark", type: "raster", source: "carto" }],
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
};

const SAT_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SAT_ATTR = "Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community";

const ID_VIEW = { center: [113, -2.4] as [number, number], zoom: 4.6 };
const SCOPE_VIEWS: Record<string, { center: [number, number]; zoom: number }> = {
  indonesia: ID_VIEW,
  sea: { center: [108, 7], zoom: 3.35 },
  asia: { center: [86, 31], zoom: 2.45 },
  europe: { center: [12, 52], zoom: 3.05 },
  "middle-east": { center: [46, 27], zoom: 3.45 },
  us: { center: [-98, 39], zoom: 2.65 },
};

const RELEASE = "polaris-parity-20261115";

type ToolKey =
  | "hazards"
  | "flights"
  | "cctv"
  | "bts"
  | "maritime"
  | "energy"
  | "datacenter"
  | "satellite"
  | "maintenance";

interface TickerSegment {
  id: string;
  text: string;
  color: string;
  detail: { kind: "news" | "bmkg"; item: SituationItem };
}

function quakeColor(magnitude: number | null | undefined): string {
  const mag = magnitude ?? 0;
  if (mag >= 6) return "#ff5353";
  if (mag >= 5) return "#ff9a3d";
  if (mag >= 4) return "#ffd51c";
  return "#44ef99";
}

function aircraftIconDataUrl(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="${color}"><path d="M12 2 L15 10 L22 13 L22 15 L14.5 13.5 L14 19 L16.5 21 L16.5 22.5 L12 21.5 L7.5 22.5 L7.5 21 L10 19 L9.5 13.5 L2 15 L2 13 L9 10 Z"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default function PolarisDashboard({ onClose }: { onClose: () => void }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const map = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [ui, setUi] = useState<UiSettings>(DEFAULT_UI);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<PreviewState | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolKey | null>(null);
  const [flightTab, setFlightTab] = useState<"layers" | "overview">("layers");
  const [scope, setScope] = useState<FlightScope>("indonesia");
  const [callsign, setCallsign] = useState("");
  const [cctvCategory, setCctvCategory] = useState<CategoryKey>("all");
  const [cctvSelectedId, setCctvSelectedId] = useState<string | null>(null);
  const [popupSelection, setPopupSelection] = useState<PopupSelection | null>(null);
  const [viewerInitialId, setViewerInitialId] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [tickerDetail, setTickerDetail] = useState<TickerSegment["detail"] | null>(null);
  const [zulu, setZulu] = useState("");
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [view, setView] = useState({ zoom: ID_VIEW.zoom, center: ID_VIEW.center });

  const active = Boolean(status?.active);
  const feeds = useFeeds(active);
  const presence = usePresence(true);
  const cctvActive = tool === "cctv" && active;
  const { cameras: cctvCameras, loading: cctvLoading } = useCctvCameras(cctvActive);

  const cctvCamerasLive = useMemo(
    () => cctvCameras.map((c) => (statusOverrides[c.id] ? { ...c, status: statusOverrides[c.id] } : c)),
    [cctvCameras, statusOverrides],
  );

  /* settings + favorites hydration */
  useEffect(() => {
    setUi(loadUi());
    setFavorites(loadFavorites());
  }, []);

  const updateUi = useCallback((patch: Partial<UiSettings>) => {
    setUi((prev) => {
      const next = { ...prev, ...patch };
      saveUi(next);
      return next;
    });
  }, []);

  const toggleLayer = useCallback(
    (key: keyof LayerState) => {
      setUi((prev) => {
        const next = { ...prev, layers: { ...prev.layers, [key]: !prev.layers[key] } };
        saveUi(next);
        return next;
      });
    },
    [],
  );

  const toggleHazard = useCallback(
    (key: keyof HazardState) => {
      setUi((prev) => {
        const next = { ...prev, hazards: { ...prev.hazards, [key]: !prev.hazards[key] } };
        saveUi(next);
        return next;
      });
    },
    [],
  );

  /* preview status (Hamsa cost guardrail) */
  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/osiris/preview/status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as PreviewState);
    } catch {
      setStatusError("Status preview tidak terbaca.");
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 15_000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  async function startPreview() {
    setStatusError(null);
    const res = await fetch("/api/v1/osiris/preview/status", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatusError((body as { error?: string }).error ?? "Preview tidak bisa dimulai");
      await refreshStatus();
      return;
    }
    setStatus(body as PreviewState);
  }

  /* ZULU clock */
  useEffect(() => {
    const tick = () => setZulu(new Date().toISOString().slice(11, 19));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* map init */
  useEffect(() => {
    if (!mapRef.current || map.current) return;
    const instance = new maplibregl.Map({
      container: mapRef.current,
      style: DARK_STYLE,
      center: ID_VIEW.center,
      zoom: ID_VIEW.zoom,
      minZoom: 1,
      maxZoom: 18,
      attributionControl: { compact: true },
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    instance.on("load", () => setMapReady(true));
    instance.on("move", () => {
      const center = instance.getCenter();
      setView({ zoom: instance.getZoom(), center: [center.lng, center.lat] });
    });
    instance.on("mousemove", (e: maplibregl.MapMouseEvent) => setCursor([e.lngLat.lng, e.lngLat.lat]));
    instance.on("mouseout", () => setCursor(null));
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  /* basemap + projection */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapReady) return;
    const applyStyle = async () => {
      if (ui.basemap === "sat") {
        instance.setStyle({
          version: 8,
          sources: { esri: { type: "raster", tiles: [SAT_TILES], tileSize: 256, attribution: SAT_ATTR, maxzoom: 18 } },
          layers: [{ id: "esri-sat", type: "raster", source: "esri" }],
          glyphs: DARK_STYLE.glyphs,
        });
      } else {
        instance.setStyle(DARK_STYLE);
      }
    };
    void applyStyle();
    instance.once("styledata", () => {
      instance.setProjection({ type: ui.mode === "3d" ? "globe" : "mercator" });
      addHamsaLayers(instance);
      addFeedSources(instance);
    });
  }, [ui.basemap, ui.mode, mapReady]);

  /* live feed data into map sources */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapReady) return;
    addHamsaLayers(instance);
    addFeedSources(instance);

    const quakeFeatures = (feeds.quakes?.items ?? [])
      .filter((i) => i.lat !== null && i.lon !== null)
      .map((i) => ({
        type: "Feature" as const,
        id: undefined,
        properties: { mag: i.magnitude ?? 0, title: i.title, at: i.at ?? "", detail: i.detail ?? "" },
        geometry: { type: "Point" as const, coordinates: [i.lon, i.lat] },
      }));
    const fireFeatures = (feeds.fires?.items ?? [])
      .filter((i) => i.lat !== null && i.lon !== null)
      .map((i) => ({
        type: "Feature" as const,
        properties: { title: i.title, detail: i.detail ?? "" },
        geometry: { type: "Point" as const, coordinates: [i.lon, i.lat] },
      }));
    const disasterFeatures = (feeds.disasters?.items ?? [])
      .filter((i) => i.lat !== null && i.lon !== null)
      .map((i) => ({
        type: "Feature" as const,
        properties: { title: i.title, severity: i.severity ?? "green", detail: i.detail ?? "" },
        geometry: { type: "Point" as const, coordinates: [i.lon, i.lat] },
      }));
    const aircraftFeatures = feeds.aircraft
      .filter((a) => a.lat !== null && a.lon !== null)
      .map((a) => ({
        type: "Feature" as const,
        id: undefined,
        properties: {
          callsign: a.callsign ?? a.icao24,
          onGround: a.onGround ? "yes" : "no",
          heading: a.heading ?? 0,
          alt: a.altitude ?? 0,
        },
        geometry: { type: "Point" as const, coordinates: [a.lon, a.lat] },
      }));

    const swap = (sourceId: string, features: unknown[]) => {
      const source = instance.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: features as never });
    };
    swap("hamsa-quakes", quakeFeatures);
    swap("hamsa-fires", fireFeatures);
    swap("hamsa-disasters", disasterFeatures);
    swap("hamsa-aircraft", aircraftFeatures);
  }, [mapReady, feeds]);

  /* layer visibility from settings */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapReady) return;
    const visible = (id: string, on: boolean) => {
      if (instance.getLayer(id)) instance.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    visible("hamsa-quakes-circle", ui.layers.quakes && ui.hazards.quakes);
    visible("hamsa-fires-dot", ui.layers.fires && ui.hazards.fires);
    visible("hamsa-disasters-dot", ui.layers.disasters && ui.hazards.weather);
    visible("hamsa-aircraft-symbol", ui.layers.aircraft);
  }, [mapReady, ui.layers, ui.hazards]);

  const flyTo = useCallback((center: [number, number], zoom: number) => {
    map.current?.flyTo({ center, zoom, duration: 1200 });
  }, []);

  function selfTrack() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => flyTo([pos.coords.longitude, pos.coords.latitude], 18),
      () => undefined,
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }

  const tickerSegments = useMemo<TickerSegment[]>(() => {
    const quakes = (feeds.quakes?.items ?? []).slice(0, 6).map((item) => ({
      id: `q-${item.id}`,
      text: item.title,
      color: quakeColor(item.magnitude),
      detail: { kind: "bmkg" as const, item },
    }));
    const news = (feeds.news?.items ?? []).slice(0, 10).map((item) => ({
      id: `n-${item.id}`,
      text: item.title,
      color: "#61eaff",
      detail: { kind: "news" as const, item },
    }));
    return [...quakes, ...news];
  }, [feeds.quakes, feeds.news]);

  const hazardCounts = useMemo(
    () => ({
      quakes: feeds.quakes?.items.length ?? 0,
      fires: feeds.fires?.items.length ?? 0,
      weather: feeds.disasters?.items.length ?? 0,
      volcanoes: 0,
    }),
    [feeds],
  );

  const aircraftFiltered = useMemo(
    () =>
      callsign
        ? feeds.aircraft.filter((a) => (a.callsign ?? "").toUpperCase().includes(callsign.toUpperCase()))
        : feeds.aircraft,
    [feeds.aircraft, callsign],
  );

  const cctvCounts = useMemo(() => categoryCounts(cctvCamerasLive), [cctvCamerasLive]);
  const cctvFiltered = useMemo(
    () => filterCameras(cctvCamerasLive, cctvCategory, favorites),
    [cctvCamerasLive, cctvCategory, favorites],
  );
  const cctvLiveCount = useMemo(
    () => cctvFiltered.filter((c) => c.status === "live").length,
    [cctvFiltered],
  );

  function toggleFavorite(cameraId: string) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(cameraId)) next.delete(cameraId);
      else next.add(cameraId);
      saveFavorites(next);
      return next;
    });
  }

  return (
    <div className="polaris-shell">
      <main className="osiris">
        <div className="osiris__map" ref={mapRef} />

        <div className="osiris__brand">
          POLARIS
          <span className="osiris__subtitle">Hamsa · digital intelligence console</span>
        </div>
        <OnlineCount count={presence} />
        <button type="button" className="osiris-exit" onClick={onClose} aria-label="Tutup Polaris dashboard">
          EXIT
        </button>

        <div className="osiris__readout">
          <span>
            <strong>ZULU</strong> {zulu}Z
          </span>
          <span>
            STATUS: <strong>{active ? "LIVE" : "STANDBY"}</strong>
          </span>
          <span>PREVIEW {active ? `${status?.secondsRemaining ?? 0}s` : "CLOSED"}</span>
        </div>

        {cursor && (
          <div className="osiris__cursor-readout">
            <span>
              <strong>{cursor[0].toFixed(3)}°</strong> / {cursor[1].toFixed(3)}°
            </span>
          </div>
        )}

        {tickerSegments.length > 0 && (
          <div className="osiris__news-ticker" aria-label="Live news ticker">
            <span className="osiris__ticker-live">● LIVE</span>
            <div className="osiris__ticker-scrollport">
              <div className="osiris__ticker-stream">
                {[...tickerSegments, ...tickerSegments].map((segment, i) => (
                  <button
                    key={`${segment.id}-${i}`}
                    className="osiris__ticker-item"
                    type="button"
                    onClick={() => setTickerDetail(segment.detail)}
                  >
                    {segment.text} <b>[Hamsa]</b>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tickerSegments.length > 0 && (
          <div className="osiris__bottom-ticker" aria-label="Quake ticker">
            <span className="osiris__bottom-source">● BMKG</span>
            <div className="osiris__ticker-scrollport">
              <div className="osiris__bottom-stream">
                {[...tickerSegments, ...tickerSegments].map((segment, i, all) => (
                  <span key={`b-${segment.id}-${i}`} className="osiris__bottom-cluster">
                    <button
                      className={`osiris__bottom-segment${segment.detail.kind === "bmkg" ? " osiris__bottom-segment--quake" : ""}`}
                      style={{ "--ticker-color": segment.color } as React.CSSProperties}
                      type="button"
                      onClick={() => setTickerDetail(segment.detail)}
                    >
                      {segment.text}
                    </button>
                    {i < all.length - 1 && <span className="osiris__bottom-separator">|</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <nav className="osiris__left-tools" aria-label="Osiris intelligence layers">
          <button
            className="osiris__left-tool"
            data-tool="home"
            type="button"
            title="Home: seluruh Indonesia"
            onClick={() => flyTo(ID_VIEW.center, ID_VIEW.zoom)}
          >
            ⌂
          </button>
          <button
            className="osiris__left-tool"
            data-tool="self-track"
            type="button"
            title="Self Track: lokasi saya · zoom 18.0"
            aria-label="Self Track"
            onClick={selfTrack}
          >
            ◎
          </button>
          <div className="osiris__hazards">
            <button
              className="osiris__left-tool"
              data-tool="hazards"
              type="button"
              title="Natural Hazards: BMKG, USGS, NASA FIRMS, GDACS, MAGMA/PVMBG"
              aria-pressed={tool === "hazards"}
              onClick={() => setTool(tool === "hazards" ? null : "hazards")}
            >
              ⚠
              {hazardCounts.quakes + hazardCounts.fires + hazardCounts.weather > 0 && (
                <span className="osiris__badge">!</span>
              )}
            </button>
            {tool === "hazards" && (
              <HazardsPanel
                state={ui.hazards}
                counts={hazardCounts}
                onToggle={toggleHazard}
                onClose={() => setTool(null)}
              />
            )}
          </div>
          <div className="osiris__aviation">
            <button
              className="osiris__left-tool"
              data-tool="flights"
              type="button"
              title="Flights: OpenSky live"
              aria-pressed={tool === "flights"}
              disabled={!active}
              onClick={() => setTool(tool === "flights" ? null : "flights")}
            >
              ✈
            </button>
            {tool === "flights" && (
              <FlightsPanel
                enabled={ui.layers.aircraft}
                onToggle={() => toggleLayer("aircraft")}
                onClose={() => setTool(null)}
                aircraft={aircraftFiltered}
                scope={scope}
                onScope={setScope}
                onView={() => flyTo(view.center, Math.max(view.zoom, 5.5))}
                callsign={callsign}
                onCallsign={setCallsign}
                scopeNote="Sumber mencakup Indonesia; cakupan region lain mengikuti sumber OpenSky yang tersedia di server Hamsa."
              />
            )}
          </div>
          <div className="osiris__cctv">
            <button
              className="osiris__left-tool"
              data-tool="cctv"
              type="button"
              title="Surveillance: Public CCTV"
              aria-pressed={tool === "cctv"}
              onClick={() => setTool(tool === "cctv" ? null : "cctv")}
            >
              ◉
            </button>
            {tool === "cctv" && (
              <CctvCategoryPanel
                visible={ui.layers.cctv}
                liveCount={cctvLiveCount}
                category={cctvCategory}
                categoryCounts={cctvCounts}
                onToggle={() => toggleLayer("cctv")}
                onCategory={(key) => {
                  setCctvCategory(key);
                  setPopupSelection(null);
                  setCctvSelectedId(null);
                }}
                onClose={() => {
                  setTool(null);
                  setPopupSelection(null);
                  setCctvSelectedId(null);
                }}
              />
            )}
          </div>
          <div className="osiris__space">
            <button
              className="osiris__left-tool"
              data-tool="satellite"
              type="button"
              title="Space Tracking: CelesTrak stations"
              aria-pressed={tool === "satellite"}
              onClick={() => setTool(tool === "satellite" ? null : "satellite")}
            >
              ✦
            </button>
            {tool === "satellite" && (
              <SpacePanel
                satellites={feeds.satellites}
                enabled={false}
                onToggle={() => undefined}
                onClose={() => setTool(null)}
              />
            )}
          </div>
          <div className="osiris-maritime-tool">
            <button
              className="osiris__left-tool"
              data-tool="maritime"
              type="button"
              title="Maritime: Pelabuhan"
              aria-label="Maritime: Pelabuhan"
              aria-pressed={tool === "maritime"}
              onClick={() => setTool(tool === "maritime" ? null : "maritime")}
            >
              ⚓
            </button>
            {tool === "maritime" && <UnavailablePanel kind="maritime" onClose={() => setTool(null)} />}
          </div>
          <div className="osiris-energy-tool">
            <button
              className="osiris__left-tool"
              data-tool="energy"
              type="button"
              title="Energy: Indonesia Power Map"
              aria-label="Energy: Indonesia Power Map"
              aria-pressed={tool === "energy"}
              onClick={() => setTool(tool === "energy" ? null : "energy")}
            >
              ⚡
            </button>
            {tool === "energy" && <UnavailablePanel kind="energy" onClose={() => setTool(null)} />}
          </div>
          <div className="polaris-dc-tool">
            <button
              className="osiris__left-tool"
              data-tool="datacenter"
              type="button"
              title="Data Center: Indonesia"
              aria-label="Data Center: Indonesia"
              aria-pressed={tool === "datacenter"}
              onClick={() => setTool(tool === "datacenter" ? null : "datacenter")}
            >
              ▤
            </button>
            {tool === "datacenter" && <UnavailablePanel kind="datacenter" onClose={() => setTool(null)} />}
          </div>
          <div className="osiris-bts-tool">
            <button
              className="osiris__left-tool"
              data-tool="bts"
              type="button"
              title="Cell Towers: BTS"
              aria-label="Layer BTS"
              aria-pressed={tool === "bts"}
              onClick={() => setTool(tool === "bts" ? null : "bts")}
            >
              ⌸
            </button>
            {tool === "bts" && <UnavailablePanel kind="bts" onClose={() => setTool(null)} />}
          </div>
          <div className="osiris-maintenance-tool">
            <button
              className="osiris__left-tool"
              data-tool="maintenance"
              type="button"
              title="Maintenance: Polaris"
              aria-label="Maintenance Polaris"
              aria-pressed={tool === "maintenance"}
              aria-expanded={tool === "maintenance"}
              aria-controls="osiris-maintenance-panel"
              onClick={() => setTool(tool === "maintenance" ? null : "maintenance")}
            >
              ⚒
            </button>
            {tool === "maintenance" && <MaintenancePanel release={RELEASE} onClose={() => setTool(null)} />}
          </div>
        </nav>

        {cctvActive && (
          <CctvMapLayer
            map={map.current}
            isLoaded={mapReady}
            cameras={cctvFiltered}
            visible={ui.layers.cctv}
            selectedId={cctvSelectedId}
            onSelect={(selected) => {
              const first = selected[0];
              setPopupSelection({ cameras: selected, lng: first.lng, lat: first.lat });
              setCctvSelectedId(first.id);
            }}
          />
        )}

        {cctvActive && popupSelection && (
          <PreviewPopup
            map={map.current}
            selection={popupSelection}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onClose={() => {
              setPopupSelection(null);
              setCctvSelectedId(null);
            }}
            onOpen={(cameraId) => {
              setViewerInitialId(cameraId);
              setViewerOpen(true);
            }}
            onStatusChange={(cameraId, status) =>
              setStatusOverrides((prev) => ({ ...prev, [cameraId]: status }))
            }
          />
        )}

        {cctvActive && viewerOpen && (
          <CctvViewer
            cameras={cctvFiltered}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            initialCameraId={viewerInitialId}
            onClose={() => {
              setViewerOpen(false);
              setViewerInitialId(null);
            }}
          />
        )}

        <div className="osiris__zoom-controls">
          <button type="button" onClick={() => map.current?.zoomIn()} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => map.current?.zoomOut()} aria-label="Zoom out">
            −
          </button>
        </div>

        <div className="osiris__modes">
          <button
            className="osiris__mode"
            type="button"
            aria-pressed={ui.mode === "3d"}
            title="Globe 3D · denah bangunan datar saat zoom dekat"
            onClick={() => updateUi({ mode: "3d" as ViewMode })}
          >
            3D
          </button>
          <button
            className="osiris__mode"
            type="button"
            aria-pressed={ui.mode === "2d"}
            title="Peta datar 2D"
            onClick={() => updateUi({ mode: "2d" as ViewMode })}
          >
            2D
          </button>
          <button
            className="osiris__mode osiris__mode--map"
            type="button"
            aria-label="Basemap peta"
            aria-pressed={ui.basemap === "map"}
            title="Basemap peta"
            onClick={() => updateUi({ basemap: "map" as Basemap })}
          >
            MAP
          </button>
          <button
            className="osiris__mode"
            type="button"
            aria-pressed={ui.basemap === "sat"}
            title="Basemap satelit"
            onClick={() => updateUi({ basemap: "sat" as Basemap })}
          >
            SAT
          </button>
        </div>

        <TickerDetail detail={tickerDetail} onClose={() => setTickerDetail(null)} />

        {!active && (
          <div className="polaris-gate" role="dialog" aria-label="Preview closed">
            <div className="polaris-gate__card">
              <strong>POLARIS PREVIEW CLOSED</strong>
              <p>
                Data situasional ditarik hanya selama jendela preview 5 menit. Peta dan layer tetap aktif;
                feed upstream hanya berjalan saat jendela dibuka.
              </p>
              <button type="button" className="polaris-gate__start" onClick={startPreview}>
                START 5-MINUTE PREVIEW
              </button>
              {status && status.secondsUntilNext > 0 && (
                <span className="polaris-gate__cooldown">cooldown · {status.secondsUntilNext}s</span>
              )}
              {statusError && <span className="polaris-gate__error">{statusError}</span>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ─────────────────────────── map layers ─────────────────────────── */

function addFeedSources(instance: MaplibreMap): void {
  const ensureSource = (id: string) => {
    if (!instance.getSource(id)) {
      instance.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
  };
  ensureSource("hamsa-quakes");
  ensureSource("hamsa-fires");
  ensureSource("hamsa-disasters");
  ensureSource("hamsa-aircraft");
}

function addHamsaLayers(instance: MaplibreMap): void {
  addFeedSources(instance);

  if (!instance.getLayer("hamsa-quakes-circle")) {
    instance.addLayer({
      id: "hamsa-quakes-circle",
      type: "circle",
      source: "hamsa-quakes",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "mag"], 0], 3, 4, 5, 10, 6, 16, 7, 24],
        "circle-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "mag"], 0],
          3,
          "#44ef99",
          5,
          "#ffd51c",
          6,
          "#ff5353",
        ],
        "circle-opacity": 0.55,
        "circle-stroke-width": 1.2,
        "circle-stroke-color": "rgba(225,237,247,.8)",
      },
    });
    addQuakePopup(instance);
  }
  if (!instance.getLayer("hamsa-fires-dot")) {
    instance.addLayer({
      id: "hamsa-fires-dot",
      type: "circle",
      source: "hamsa-fires",
      paint: {
        "circle-radius": 2.4,
        "circle-color": "#ff7529",
        "circle-opacity": 0.75,
      },
    });
  }
  if (!instance.getLayer("hamsa-disasters-dot")) {
    instance.addLayer({
      id: "hamsa-disasters-dot",
      type: "circle",
      source: "hamsa-disasters",
      paint: {
        "circle-radius": ["match", ["get", "severity"], "red", 7, "orange", 5.5, 4],
        "circle-color": ["match", ["get", "severity"], "red", "#ff5353", "orange", "#ff9a3d", "#44ef99"],
        "circle-opacity": 0.6,
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(225,237,247,.7)",
      },
    });
    addDisasterPopup(instance);
  }
  if (!instance.getLayer("hamsa-aircraft-symbol")) {
    // Aircraft symbol layer is added after its icon loads asynchronously.
    loadAircraftIcon(instance);
  }
}

async function loadAircraftIcon(instance: MaplibreMap): Promise<void> {
  const add = (name: string, color: string) => {
    if (instance.hasImage(name)) return;
    const image = new Image();
    image.onload = () => {
      if (!instance.hasImage(name) && instance.isStyleLoaded()) {
        instance.addImage(name, image);
        if (!instance.getLayer("hamsa-aircraft-symbol")) {
          instance.addLayer({
            id: "hamsa-aircraft-symbol",
            type: "symbol",
            source: "hamsa-aircraft",
            layout: {
              "icon-image": [
                "match",
                ["coalesce", ["get", "onGround"], "no"],
                "yes",
                "hamsa-plane-ground",
                "hamsa-plane-air",
              ],
              "icon-size": 0.42,
              "icon-rotate": ["coalesce", ["get", "heading"], 0],
              "icon-rotation-alignment": "map",
              "icon-allow-overlap": true,
            },
          });
        }
      }
    };
    image.src = aircraftIconDataUrl(color);
  };
  add("hamsa-plane-air", "#24d9ef");
  add("hamsa-plane-ground", "#9aafc0");
}

function addQuakePopup(instance: MaplibreMap): void {
  instance.on("click", "hamsa-quakes-circle", (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const props = feature.properties as { title?: string; mag?: number; at?: string; detail?: string };
    new maplibregl.Popup({ className: "osiris-quake-popup", closeButton: false, maxWidth: "300px" })
      .setLngLat((feature.geometry as unknown as { coordinates: [number, number] }).coordinates)
      .setHTML(
        `<strong>M ${props.mag?.toFixed?.(1) ?? "—"}</strong><p>${props.title ?? ""}</p><small>${props.at ?? ""} · BMKG</small>`,
      )
      .addTo(instance);
  });
  instance.on("mouseenter", "hamsa-quakes-circle", () => (instance.getCanvas().style.cursor = "pointer"));
  instance.on("mouseleave", "hamsa-quakes-circle", () => (instance.getCanvas().style.cursor = ""));
}

function addDisasterPopup(instance: MaplibreMap): void {
  instance.on("click", "hamsa-disasters-dot", (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const props = feature.properties as { title?: string; severity?: string; detail?: string };
    new maplibregl.Popup({ className: "osiris-disaster-popup", closeButton: false, maxWidth: "300px" })
      .setLngLat((feature.geometry as unknown as { coordinates: [number, number] }).coordinates)
      .setHTML(`<strong>${(props.severity ?? "green").toUpperCase()}</strong><p>${props.title ?? ""}</p><small>GDACS</small>`)
      .addTo(instance);
  });
  instance.on("mouseenter", "hamsa-disasters-dot", () => (instance.getCanvas().style.cursor = "pointer"));
  instance.on("mouseleave", "hamsa-disasters-dot", () => (instance.getCanvas().style.cursor = ""));
}
