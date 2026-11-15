"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Popup as MaplibrePopup, type Map as MaplibreMap } from "maplibre-gl";
import type { PolarisCamera, CategoryKey } from "@/lib/polaris/cctv";
import { CATEGORY_LIST } from "./cctv-data";
import {
  PlayerRouter,
  FavoriteStar,
  MaximizeIcon,
  MinimizeIcon,
  CloseIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "./cctv-players";

/* ─────────────────────────── category panel (Kv parity) ─────────────────────────── */

export function CctvCategoryPanel({
  visible,
  liveCount,
  category,
  categoryCounts,
  onToggle,
  onCategory,
  onClose,
}: {
  visible: boolean;
  liveCount: number;
  category: CategoryKey;
  categoryCounts: Record<CategoryKey, number>;
  onToggle: () => void;
  onCategory: (key: CategoryKey) => void;
  onClose: () => void;
}) {
  return (
    <section className="osiris__cctv-panel" aria-label="Surveillance">
      <div className="osiris__cctv-title">
        <strong>SURVEILLANCE</strong>
        <span>
          {liveCount} / {categoryCounts.all}
        </span>
        <button
          className="osiris__cctv-layer-toggle"
          type="button"
          aria-label={visible ? "Sembunyikan CCTV" : "Tampilkan CCTV"}
          aria-pressed={visible}
          onClick={onToggle}
        >
          <i className="osiris__cctv-switch" />
        </button>
        <button
          className="osiris__cctv-panel-close"
          type="button"
          title="Tutup Surveillance"
          aria-label="Tutup Surveillance"
          onClick={onClose}
        >
          x
        </button>
      </div>
      <div className="osiris__cctv-categories" role="group" aria-label="Kategori CCTV">
        {CATEGORY_LIST.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="osiris__cctv-category"
            data-active={category === entry.key}
            onClick={() => onCategory(entry.key)}
          >
            <strong>{entry.label}</strong>
            <span>{categoryCounts[entry.key]}</span>
          </button>
        ))}
      </div>
      {category === "favorite" && categoryCounts.favorite === 0 && (
        <p className="osiris__cctv-favorite-empty">
          Belum ada CCTV favorit yang tersedia. Pilih bintang pada preview kamera.
        </p>
      )}
    </section>
  );
}

/* ─────────────────────────── preview popup (fv parity) ─────────────────────────── */

export interface PopupSelection {
  /** Cameras sharing the clicked point (sorted live-first like Phone-X). */
  cameras: PolarisCamera[];
  lng: number;
  lat: number;
}

export function PreviewPopup({
  map,
  selection,
  favorites,
  onToggleFavorite,
  onClose,
  onOpen,
  onStatusChange,
}: {
  map: MaplibreMap | null;
  selection: PopupSelection | null;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  onClose: () => void;
  onOpen: (cameraId: string) => void;
  onStatusChange: (cameraId: string, status: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);

  const sorted = useMemo(
    () =>
      selection
        ? [...selection.cameras].sort((a, b) => Number(b.status === "live") - Number(a.status === "live"))
        : [],
    [selection],
  );
  const camera = sorted[Math.min(index, Math.max(0, sorted.length - 1))];

  useEffect(() => {
    setIndex(0);
  }, [selection]);

  useEffect(() => {
    if (!map || !selection || !camera) return;
    const holder = document.createElement("div");
    holder.className = "osiris__cctv-preview-host";
    const popup = new MaplibrePopup({
      closeOnClick: false,
      focusAfterOpen: false,
      anchor: "bottom-left",
      offset: [-109, -32],
      closeButton: false,
    })
      .setLngLat([selection.lng, selection.lat])
      .setDOMContent(holder)
      .addTo(map);
    rootRef.current = holder;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popup.remove();
      rootRef.current = null;
    };
  }, [map, selection?.lng, selection?.lat, camera?.id]);

  if (!camera) return null;

  return (
    <div ref={rootRef} className="osiris__cctv-preview-popup">
      <section className="osiris__cctv-preview" aria-label="Preview CCTV" onClick={(e) => e.stopPropagation()}>
        <svg className="osiris__cctv-preview-tracers" aria-hidden="true" focusable="false">
          <rect x="1" y="1" rx="15" pathLength="100" />
        </svg>
        <div className="osiris__cctv-preview-media">
          <PlayerRouter
            camera={camera}
            compact
            onClose={onClose}
            onPlayback={(info) => onStatusChange(camera.id, info.state === "playing" ? "live" : "offline")}
          />
          <div className="osiris__cctv-preview-actions">
            <FavoriteStar favorite={favorites.has(camera.id)} onToggle={() => onToggleFavorite(camera.id)} />
            <button type="button" onClick={() => onOpen(camera.id)} aria-label={`OPEN ${camera.name}`}>
              <MaximizeIcon size={12} /> OPEN
            </button>
            <button type="button" onClick={onClose} aria-label="Tutup preview CCTV">
              <CloseIcon size={14} />
            </button>
          </div>
        </div>
        <footer className="osiris__cctv-preview-footer">
          <span className="osiris__cctv-preview-name" title={camera.name}>
            {camera.name}
          </span>
          {sorted.length > 1 && (
            <nav aria-label="Kamera pada titik ini">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                aria-label="Preview kamera sebelumnya"
              >
                <ChevronLeftIcon size={14} />
              </button>
              <span>
                {index + 1}/{sorted.length}
              </span>
              <button
                type="button"
                disabled={index >= sorted.length - 1}
                onClick={() => setIndex((i) => Math.min(sorted.length - 1, i + 1))}
                aria-label="Preview kamera berikutnya"
              >
                <ChevronRightIcon size={14} />
              </button>
            </nav>
          )}
        </footer>
      </section>
    </div>
  );
}

/* ─────────────────────────── viewer monitor (wv parity) ─────────────────────────── */

const LAYOUTS = {
  "1x1": { label: "1×1", capacity: 1 },
  "2x2": { label: "2×2", capacity: 4 },
} as const;

export function CctvViewer({
  cameras,
  favorites,
  onToggleFavorite,
  onClose,
  initialCameraId,
}: {
  cameras: PolarisCamera[];
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  onClose: () => void;
  initialCameraId?: string | null;
}) {
  const sorted = useMemo(
    () => [...cameras].sort((a, b) => Number(b.status === "live") - Number(a.status === "live")),
    [cameras],
  );
  const [layout, setLayout] = useState<keyof typeof LAYOUTS>("1x1");
  const [pageStart, setPageStart] = useState(() =>
    initialCameraId ? Math.max(0, sorted.findIndex((c) => c.id === initialCameraId)) : 0,
  );
  const [closed, setClosed] = useState<string[]>([]);
  const capacity = LAYOUTS[layout].capacity;
  const shown = sorted.slice(pageStart, pageStart + capacity);
  const remaining = shown.filter((c) => !closed.includes(c.id)).map((c) => c.id);

  const go = (start: number, next: keyof typeof LAYOUTS = layout) => {
    setLayout(next);
    setPageStart(start);
    setClosed([]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        document.fullscreenElement ||
        document.querySelector('.osiris__cctv-tile[data-fullscreen="true"]')
      ) {
        return;
      }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="osiris__cctv-browser" data-layout={layout}>
      <section
        className={`osiris__cctv-viewer${layout !== "1x1" ? " osiris__cctv-viewer--multi" : ""}`}
        aria-label="CCTV viewer"
      >
        <header className="osiris__cctv-viewer-header">
          <strong>
            CCTV MONITOR{" "}
            <span>
              {LAYOUTS[layout].label} · {pageStart + 1}–{Math.min(pageStart + capacity, sorted.length)} /{" "}
              {sorted.length}
            </span>
          </strong>
          <nav className="osiris__cctv-layouts osiris__cctv-layouts--header" aria-label="Tampilan CCTV">
            {(Object.keys(LAYOUTS) as (keyof typeof LAYOUTS)[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={layout === key}
                onClick={() => go(Math.floor(pageStart / LAYOUTS[key].capacity) * LAYOUTS[key].capacity, key)}
              >
                {LAYOUTS[key].label}
              </button>
            ))}
          </nav>
          <button
            className="osiris__cctv-viewer-close"
            type="button"
            title="Tutup CCTV Monitor"
            aria-label="Tutup CCTV Monitor"
            onClick={onClose}
          >
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="osiris__cctv-grid" data-layout={layout} tabIndex={0} role="region" aria-label="Frame CCTV dan informasi kamera">
          {Array.from({ length: capacity }, (_, slot) => {
            const cam = shown[slot];
            if (!cam || closed.includes(cam.id)) {
              return (
                <div className="osiris__cctv-empty" key={`empty-${slot}`}>
                  {cam ? "Layar ditutup" : "Tidak ada kamera lainnya"}
                </div>
              );
            }
            const closeTile = () => {
              if (remaining.length === 1) {
                onClose();
                return;
              }
              setClosed((prev) => [...prev, cam.id]);
            };
            return (
              <Tile
                key={cam.id}
                camera={cam}
                compact={layout !== "1x1"}
                favorite={favorites.has(cam.id)}
                onToggleFavorite={onToggleFavorite}
                onClose={closeTile}
              />
            );
          })}
        </div>
        <nav className="osiris__cctv-pagination" aria-label="Halaman CCTV">
          <button type="button" aria-label="Sebelumnya" title="Sebelumnya" disabled={pageStart === 0} onClick={() => go(Math.max(0, pageStart - capacity))}>
            &lt;
          </button>
          <span>{`${remaining.length} kamera dipilih`}</span>
          <button
            type="button"
            aria-label="Berikutnya"
            title="Berikutnya"
            disabled={pageStart + capacity >= sorted.length}
            onClick={() => go(pageStart + capacity)}
          >
            &gt;
          </button>
        </nav>
      </section>
    </div>
  );
}

/* ─────────────────────────── tile (Pv parity) ─────────────────────────── */

function Tile({
  camera,
  compact,
  favorite,
  onToggleFavorite,
  onClose,
}: {
  camera: PolarisCamera;
  compact: boolean;
  favorite: boolean;
  onToggleFavorite: (id: string) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLButtonElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const active = isFullscreen || expanded;

  useEffect(() => {
    const onChange = () => {
      const fs = document.fullscreenElement === containerRef.current;
      setIsFullscreen(fs);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (document.fullscreenElement === containerRef.current) {
      await document.exitFullscreen();
      return;
    }
    try {
      if (!containerRef.current?.requestFullscreen || !document.fullscreenEnabled) {
        setExpanded(true);
        return;
      }
      await containerRef.current.requestFullscreen();
    } catch {
      setExpanded(true);
    }
  };

  return (
    <div
      ref={containerRef}
      className="osiris__cctv-tile"
      data-expanded={expanded || undefined}
      data-fullscreen={active || undefined}
    >
      <PlayerRouter camera={camera} compact={compact} onClose={onClose} />
      <FavoriteStar favorite={favorite} onToggle={() => onToggleFavorite(camera.id)} />
      <button
        ref={focusRef}
        className="osiris__cctv-fullscreen"
        type="button"
        onClick={toggleFullscreen}
        title={active ? "Keluar layar penuh" : "Layar penuh · lihat gambar utuh"}
        aria-label={`${active ? "Keluar layar penuh" : "Layar penuh"} ${camera.name}`}
        aria-pressed={active}
      >
        {active ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
      </button>
    </div>
  );
}
