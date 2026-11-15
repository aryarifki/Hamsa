"use client";

import { useEffect } from "react";
import { Marker, type Map as MaplibreMap, type MapMouseEvent, type MapGeoJSONFeature } from "maplibre-gl";
import type { PolarisCamera } from "@/lib/polaris/cctv";

const SOURCE_ID = "osiris-cctv";
const CLUSTER_ID = "osiris-cctv-cluster";
const COUNT_ID = "osiris-cctv-cluster-count";
const CAMERA_ID = "osiris-cctv-camera";
const ICON_ID = "osiris-cctv-camera-icon";

/** SDF-friendly CCTV glyph, white so maplibre `icon-color` tints it. */
function cameraIcon(): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CCTV icon canvas unavailable");
  ctx.clearRect(0, 0, 48, 48);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(5, 13, 27, 18, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(32, 18);
  ctx.lineTo(44, 12);
  ctx.lineTo(44, 32);
  ctx.lineTo(32, 27);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(16, 31, 5, 8);
  ctx.fillRect(10, 39, 17, 4);
  return ctx.getImageData(0, 0, 48, 48);
}

function wrapLabel(name: string): string {
  const compact = name.replace(/\s+/g, " ").trim();
  if (compact.length <= 24) return compact;
  const mid = compact.length / 2;
  const splits = [...compact.matchAll(/\s+|\//g)]
    .map((m) => m.index + (m[0] === "/" ? 1 : 0))
    .filter((i) => i > 0 && i < compact.length);
  const cut = splits.reduce(
    (best, i) => (Math.abs(i - mid) < Math.abs(best - mid) ? i : best),
    splits[0] ?? Math.ceil(mid),
  );
  return `${compact.slice(0, cut).trim()}\n${compact.slice(cut).trim()}`;
}

export function CctvMapLayer({
  map,
  isLoaded,
  cameras,
  visible,
  selectedId,
  onSelect,
}: {
  map: MaplibreMap | null;
  isLoaded: boolean;
  cameras: PolarisCamera[];
  visible: boolean;
  selectedId: string | null;
  onSelect: (cameras: PolarisCamera[]) => void;
}) {
  useEffect(() => {
    if (!isLoaded || !map) return;

    const features = cameras.map((cam) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [cam.lng, cam.lat] },
      properties: { ...cam, mapLabel: wrapLabel(cam.name) },
    }));

    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features },
      cluster: true,
      clusterMaxZoom: 10,
      clusterRadius: 48,
    });
    if (!map.hasImage(ICON_ID)) map.addImage(ICON_ID, cameraIcon(), { sdf: true });
    map.addLayer({
      id: CLUSTER_ID,
      type: "symbol",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      layout: {
        "icon-image": ICON_ID,
        "icon-size": 0.4,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-pitch-alignment": "viewport",
        "icon-rotation-alignment": "viewport",
      },
      paint: {
        "icon-color": "#ffd51c",
        "icon-halo-color": "#02050a",
        "icon-halo-width": 1.15,
      },
    });
    map.addLayer({
      id: COUNT_ID,
      type: "symbol",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 10,
        "text-anchor": "top",
        "text-offset": [0, 1.6],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-pitch-alignment": "viewport",
        "text-rotation-alignment": "viewport",
      },
      paint: {
        "text-color": "#fff0a1",
        "text-halo-color": "#02050a",
        "text-halo-width": 1.5,
      },
    });
    map.addLayer({
      id: CAMERA_ID,
      type: "symbol",
      source: SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ICON_ID,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.22, 9, 0.4],
        "icon-anchor": "center",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": ["get", "mapLabel"],
        "text-size": 8,
        "text-anchor": "top",
        "text-offset": [0, 1.3],
        "text-max-width": ["max", 1, ["length", ["get", "mapLabel"]]],
        "text-justify": "center",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "icon-color": "#ffd51c",
        "icon-halo-color": "#02050a",
        "icon-halo-width": 1.15,
        "icon-opacity": 1,
        "text-color": "#fff0a1",
        "text-opacity": ["step", ["zoom"], 0, 12, 1],
        "text-halo-color": "#02050a",
        "text-halo-width": 1.5,
      },
    });

    const onCameraClick = (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const unique = [
        ...new Map(
          (event.features ?? [])
            .filter((f: MapGeoJSONFeature) => f.geometry.type === "Point")
            .map((f: MapGeoJSONFeature) => [f.properties?.id as string, f.properties as unknown as PolarisCamera]),
        ).values(),
      ];
      if (unique.length) onSelect(unique);
    };
    const onClusterClick = (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const feature = event.features?.[0];
      const geometry = feature?.geometry;
      if (!feature || !geometry || geometry.type !== "Point") return;
      map.easeTo({ center: geometry.coordinates as [number, number], zoom: Math.min(map.getZoom() + 1.7, 12), duration: 360 });
    };
    const setPointer = () => {
      if (map.getCanvas()) map.getCanvas().style.cursor = "pointer";
    };
    const setDefault = () => {
      if (map.getCanvas()) map.getCanvas().style.cursor = "";
    };

    map.on("click", CAMERA_ID, onCameraClick);
    map.on("click", CLUSTER_ID, onClusterClick);
    map.on("click", COUNT_ID, onClusterClick);
    map.on("mouseenter", CAMERA_ID, setPointer);
    map.on("mouseleave", CAMERA_ID, setDefault);
    map.on("mouseenter", CLUSTER_ID, setPointer);
    map.on("mouseleave", CLUSTER_ID, setDefault);
    map.on("mouseenter", COUNT_ID, setPointer);
    map.on("mouseleave", COUNT_ID, setDefault);

    return () => {
      map.off("click", CAMERA_ID, onCameraClick);
      map.off("click", CLUSTER_ID, onClusterClick);
      map.off("click", COUNT_ID, onClusterClick);
      map.off("mouseenter", CAMERA_ID, setPointer);
      map.off("mouseleave", CAMERA_ID, setDefault);
      map.off("mouseenter", CLUSTER_ID, setPointer);
      map.off("mouseleave", CLUSTER_ID, setDefault);
      map.off("mouseenter", COUNT_ID, setPointer);
      map.off("mouseleave", COUNT_ID, setDefault);
      for (const layer of [CAMERA_ID, COUNT_ID, CLUSTER_ID]) {
        if (map.getLayer(layer)) map.removeLayer(layer);
      }
      if (map.hasImage(ICON_ID)) map.removeImage(ICON_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map, isLoaded, cameras, onSelect]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    for (const layer of [CLUSTER_ID, COUNT_ID, CAMERA_ID]) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
    }
  }, [map, isLoaded, visible]);

  // Selection pulse (Phone-X `Fa`).
  useEffect(() => {
    if (!isLoaded || !map || !visible || !selectedId) return;
    const selected = cameras.find((c) => c.id === selectedId);
    if (!selected) return;
    const el = document.createElement("span");
    el.className = "osiris-map-selection-pulse";
    el.setAttribute("aria-hidden", "true");
    const marker = new Marker({ element: el, anchor: "center" })
      .setLngLat([selected.lng, selected.lat])
      .addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, isLoaded, visible, selectedId, cameras]);

  return null;
}
