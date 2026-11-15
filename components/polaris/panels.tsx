"use client";

import { useEffect, useState } from "react";
import type {
  Aircraft,
  HazardState,
  Satellite,
  SituationItem,
} from "./data";

/**
 * Polaris panels (Phone-X parity). Class names mirror the Polaris-X CSS so the
 * ported stylesheet applies unchanged; every data claim comes from Hamsa's own
 * endpoints. Feeds Phone-X has but Hamsa does not ship render their authentic
 * "SOURCE UNAVAILABLE" panel state instead of invented data.
 */

/* ─────────────────────────── shared bits ─────────────────────────── */

export function PanelHeader({ title, onClose, closeLabel }: { title: string; onClose: () => void; closeLabel: string }) {
  return (
    <div className="osiris__hazards-title">
      <strong>{title}</strong>
      <button type="button" title={closeLabel} onClick={onClose}>
        x
      </button>
    </div>
  );
}

/* ─────────────────────────── hazards ─────────────────────────── */

export function HazardsPanel({
  state,
  counts,
  onToggle,
  onClose,
}: {
  state: HazardState;
  counts: { quakes: number; fires: number; weather: number; volcanoes: number };
  onToggle: (key: keyof HazardState) => void;
  onClose: () => void;
}) {
  const options: Array<{ key: keyof HazardState; title: string; note: string }> = [
    { key: "quakes", title: "EARTHQUAKES", note: "BMKG + USGS live earthquakes" },
    { key: "fires", title: "ACTIVE FIRES", note: "NASA FIRMS live hotspots" },
    { key: "weather", title: "SEVERE WEATHER", note: "NASA EONET, NOAA/NWS, GDACS" },
    { key: "volcanoes", title: "VOLCANOES", note: "MAGMA/PVMBG · snapshot feed" },
  ];
  return (
    <section className="osiris__hazards-panel" aria-label="Natural hazards layers">
      <PanelHeader title="NATURAL HAZARDS" onClose={onClose} closeLabel="Tutup Natural Hazards" />
      <p className="osiris__hazards-note">
        Gempa BMKG dan USGS. Hotspot NASA FIRMS. Cuaca NASA EONET, NOAA/NWS, GDACS. Gunung api MAGMA/PVMBG.
      </p>
      {options.map((option) => (
        <button
          key={option.key}
          className={`osiris__hazard-option${option.key === "volcanoes" ? " osiris__hazard-option--magma" : ""}`}
          type="button"
          aria-pressed={state[option.key]}
          onClick={() => onToggle(option.key)}
        >
          <span>
            <strong>{option.title}</strong>
            <small>{option.note}</small>
          </span>
          <b className="osiris__hazard-count">{counts[option.key]}</b>
          <i className="osiris__hazard-indicator" />
        </button>
      ))}
    </section>
  );
}

/* ─────────────────────────── flights ─────────────────────────── */

export const FLIGHT_SCOPES = [
  { value: "indonesia", label: "Indonesia" },
  { value: "sea", label: "SEA" },
  { value: "asia", label: "Asia" },
  { value: "europe", label: "Europe" },
  { value: "middle-east", label: "Middle East" },
  { value: "us", label: "US" },
  { value: "current", label: "Current View" },
  { value: "global", label: "Global Search" },
] as const;

export type FlightScope = (typeof FLIGHT_SCOPES)[number]["value"];

export function FlightsPanel({
  enabled,
  onToggle,
  onClose,
  aircraft,
  scope,
  onScope,
  onView,
  callsign,
  onCallsign,
  scopeNote,
}: {
  enabled: boolean;
  onToggle: () => void;
  onClose: () => void;
  aircraft: Aircraft[];
  scope: FlightScope;
  onScope: (scope: FlightScope) => void;
  onView: () => void;
  callsign: string;
  onCallsign: (value: string) => void;
  scopeNote: string;
}) {
  const airborne = aircraft.filter((a) => !a.onGround).length;
  const ground = aircraft.filter((a) => a.onGround).length;
  const total = aircraft.length || 1;
  const categories = [
    { key: "airborne", name: "Sedang terbang", color: "#24d9ef", count: airborne },
    { key: "ground", name: "On ground", color: "#9aafc0", count: ground },
  ];
  const filtered = callsign
    ? aircraft.filter((a) => (a.callsign ?? "").toUpperCase().includes(callsign.toUpperCase()))
    : aircraft;

  return (
    <section className="osiris__aviation-scope" aria-label="Aviation scope">
      <header className="osiris__flights-header">
        <h2>Flights</h2>
        <button
          className="osiris__flights-switch"
          type="button"
          role="switch"
          aria-label="Tampilkan pesawat"
          aria-checked={enabled}
          onClick={onToggle}
        >
          <span />
        </button>
        <button className="osiris__flights-close" type="button" aria-label="Tutup panel Flights" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="osiris__flights-totals" aria-live="polite">
        <div>
          <strong>{(enabled ? airborne : 0).toLocaleString("id-ID")}</strong>
          <span>di area peta</span>
        </div>
        <div>
          <strong>{(enabled ? aircraft.length : 0).toLocaleString("id-ID")}</strong>
          <span>total unik</span>
        </div>
      </div>
      {!enabled && <p className="osiris__flights-empty">Layer pesawat disembunyikan.</p>}
      <div className="osiris__flight-categories">
        {categories.map((category) => (
          <div key={category.key} className="osiris__flight-category" style={{ "--flight-category-color": category.color } as React.CSSProperties}>
            <span className="osiris__flight-category-label">
              <i />
              <strong>{category.name}</strong>
            </span>
            <div className="osiris__flights-bar">
              <i style={{ width: `${enabled ? (category.count / total) * 100 : 0}%` }} />
            </div>
            <b>{(enabled ? category.count : 0).toLocaleString("id-ID")}</b>
          </div>
        ))}
      </div>
      <details className="osiris__flights-details">
        <summary>Area &amp; pencarian</summary>
        <label>
          <select value={scope} onChange={(e) => onScope(e.target.value as FlightScope)}>
            {FLIGHT_SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {scope === "current" && (
          <button type="button" className="osiris__flights-view" onClick={onView}>
            USE CURRENT VIEW
          </button>
        )}
        <label>
          <input
            value={callsign}
            onChange={(e) => onCallsign(e.target.value.toUpperCase())}
            placeholder="CALLSIGN"
            maxLength={12}
          />
        </label>
        <p className="osiris__flight-data-note">{scopeNote}</p>
        {callsign && (
          <ul className="osiris__flights-list">
            {filtered.slice(0, 24).map((a) => (
              <li key={a.icao24}>
                <strong>{a.callsign ?? "—"}</strong>
                <small>
                  {a.lat !== null && a.lon !== null ? `${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}` : "posisi belum tersedia"}
                </small>
              </li>
            ))}
            {filtered.length === 0 && <li className="osiris__flights-empty">Tidak ada callsign yang cocok.</li>}
          </ul>
        )}
      </details>
    </section>
  );
}

/* ─────────────────────────── space tracking ─────────────────────────── */

export function SpacePanel({
  satellites,
  enabled,
  onToggle,
  onClose,
}: {
  satellites: Satellite[];
  enabled: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const source = satellites.length
    ? "CelesTrak stations catalogue"
    : "CelesTrak TLE catalogue";
  return (
    <section className="osiris__space-panel" aria-label="Space Tracking">
      <div className="osiris__space-title">
        <strong>SPACE TRACKING</strong>
        <button type="button" title="Tutup Space Tracking" onClick={onClose}>
          x
        </button>
      </div>
      <button
        className="osiris__space-switch"
        type="button"
        role="switch"
        aria-label="Tampilkan satelit"
        aria-checked={enabled}
        onClick={onToggle}
      >
        <span />
      </button>
      <div className="osiris__space-options">
        <div className="osiris__space-option" data-active={enabled}>
          <strong>ALL SATELLITES · STATIONS</strong>
          <small>
            {source}. {satellites.length.toLocaleString("en-US")} objects.
          </small>
        </div>
      </div>
      <p className="osiris__space-note">
        Hamsa memuat grup stations CelesTrak. Kategori Starlink/militer/navigasi (Phone-X) tidak diaktifkan —
        tidak ada data lokal, tidak ada angka yang dikarang.
      </p>
    </section>
  );
}

/* ─────────────── panels without a Hamsa data source ─────────────── */

export function UnavailablePanel({
  kind,
  onClose,
}: {
  kind: "maritime" | "energy" | "datacenter" | "bts";
  onClose: () => void;
}) {
  const copy = {
    maritime: {
      title: "MARITIME",
      note: "Kapal, pelabuhan, dan alur pelayaran.",
      rows: ["LIVE SHIP TRAFFIC · AIS", "PELABUHAN UMUM", "RUTE PELAYARAN", "FISHING PORTS · PIPP KKP"],
      cls: "osiris-maritime-panel",
    },
    energy: {
      title: "ENERGY · INDONESIA POWER MAP",
      note: "Jaringan transmisi, gardu induk, dan pembangkit.",
      rows: ["TRANSMISSION", "SUBSTATIONS", "POWER PLANTS", "BBM DISTRIBUTOR · ESDM"],
      cls: "osiris-energy-panel",
    },
    datacenter: {
      title: "DATA CENTER",
      note: "Data center di Indonesia.",
      rows: ["DAFTAR LOKASI"],
      cls: "polaris-dc-panel",
    },
    bts: {
      title: "LAYER BTS",
      note: "Tower seluler (OpenCelliD).",
      rows: ["OPERATOR", "RADIO 2G/3G/4G/5G"],
      cls: "osiris-bts-panel",
    },
  }[kind];

  return (
    <section className={copy.cls} aria-label={copy.title}>
      <PanelHeader title={copy.title} onClose={onClose} closeLabel={`Tutup ${copy.title}`} />
      <p className="osiris__hazards-note">{copy.note}</p>
      {copy.rows.map((row) => (
        <button
          key={row}
          className="osiris-maritime-panel__toggle"
          type="button"
          disabled
          aria-pressed={false}
          title="Feed tidak dikonfigurasi di Hamsa"
        >
          <span>
            <strong>{row}</strong>
            <small>SOURCE UNAVAILABLE</small>
          </span>
          <i />
        </button>
      ))}
      <p className="osiris__hazards-note">
        Hamsa belum menjalankan feed ini. Struktur panel mengikuti Polaris-X; sumber bisa diaktifkan lewat
        endpoint Hamsa sendiri tanpa memakai data Phone-X.
      </p>
    </section>
  );
}

export function MaintenancePanel({ onClose, release }: { onClose: () => void; release: string }) {
  return (
    <section className="osiris-maintenance-panel" id="osiris-maintenance-panel" aria-label="Maintenance">
      <header>
        <button type="button" title="Tutup Maintenance" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="osiris-maintenance-copy">
        <p>
          <strong>Hamsa Polaris</strong> — build {release}.
        </p>
        <p>
          Data situasional hanya ditarik selama jendela preview aktif (5 menit) dan berhenti total saat jendela
          ditutup. Layer tanpa feed lokal ditampilkan sebagai SOURCE UNAVAILABLE, bukan data kosong palsu.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────── header + bottom ─────────────────────────── */

export function OnlineCount({ count }: { count: number | null }) {
  return (
    <div
      className="polaris-online-count"
      data-available={count !== null}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={count === null ? "Jumlah pengunjung Polaris online belum tersedia" : `${count} pengunjung Polaris online`}
      title="Pengunjung aktif dalam 90 detik terakhir. Beberapa tab pada browser yang sama dihitung sekali."
    >
      <span className="polaris-online-count__dot" aria-hidden="true" />
      <span>
        <strong>{count === null ? "—" : count.toLocaleString("id-ID")}</strong>
        <span className="polaris-online-count__label"> online</span>
      </span>
    </div>
  );
}

export function TickerDetail({
  detail,
  onClose,
}: {
  detail: { kind: "news" | "bmkg"; item: SituationItem } | null;
  onClose: () => void;
}) {
  if (!detail) return null;
  return (
    <div className="osiris__ticker-detail" role="dialog" aria-label="Detail">
      <button type="button" className="osiris__ticker-detail-close" onClick={onClose}>
        ×
      </button>
      <h2>{detail.item.title}</h2>
      <dl>
        <div>
          <dt>WAKTU</dt>
          <dd>{detail.item.at ? new Date(detail.item.at).toLocaleString("id-ID") : "—"}</dd>
        </div>
        {(detail.item.magnitude ?? null) !== null && (
          <div>
            <dt>MAGNITUDO</dt>
            <dd>M {detail.item.magnitude}</dd>
          </div>
        )}
        {detail.item.lat !== null && detail.item.lon !== null && (
          <div>
            <dt>LOKASI</dt>
            <dd>
              {detail.item.lat.toFixed(2)}, {detail.item.lon.toFixed(2)}
            </dd>
          </div>
        )}
        <div>
          <dt>SUMBER</dt>
          <dd>{detail.kind === "bmkg" ? "BMKG · Hamsa situational feed" : "RSS · Hamsa situational feed"}</dd>
        </div>
      </dl>
      {detail.item.detail && <p className="osiris__ticker-detail-body">{detail.item.detail}</p>}
      {detail.item.url && (
        <a className="osiris__ticker-detail-link" href={detail.item.url} target="_blank" rel="noreferrer">
          Buka sumber ↗
        </a>
      )}
    </div>
  );
}
