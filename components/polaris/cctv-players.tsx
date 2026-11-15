"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { PolarisCamera } from "@/lib/polaris/cctv";

/* ─────────────────────────── icons (lucide parity) ─────────────────────────── */

export function StarIcon({ size = 14, fill = "none" }: { size?: number; fill?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function MaximizeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function MinimizeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

export function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 14 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 14 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/* ─────────────────────────── status helpers ─────────────────────────── */

export function statusLine(camera: PolarisCamera, compact: boolean): string {
  const status = camera.status ?? "offline";
  if (compact) {
    if (status === "live") return "● LIVE";
    if (status === "snapshot") return "● SNAPSHOT";
    if (status === "pending") return "● PENDING";
    return "● OFFLINE";
  }
  if (status === "live") return "● LIVE CCTV · SELECTED STREAM";
  if (status === "snapshot") return "● PROVIDER SNAPSHOT · SELECTED STREAM";
  if (status === "pending") return "● PENDING · MENUNGGU SUMBER ONLINE";
  return "● SOURCE UNAVAILABLE · SNAPSHOT";
}

export function coordinatesLine(camera: PolarisCamera): string {
  if (Number.isFinite(camera.lat) && Number.isFinite(camera.lng)) {
    return `${camera.lat.toFixed(5)}, ${camera.lng.toFixed(5)}`;
  }
  return "Lat/Lon tidak tersedia";
}

/* ─────────────────────────── detail wrapper (ia parity) ─────────────────────────── */
export function FavoriteStar({
  favorite,
  onToggle,
}: {
  favorite: boolean;
  onToggle: () => void;
}) {
  return <StarIcon size={14} fill={favorite ? "currentColor" : "none"} />;
}

export function CameraDetail({
  camera,
  onClose,
  compact = false,
  children,
}: {
  camera: PolarisCamera;
  onClose: () => void;
  compact?: boolean;
  /** Player node (iframe/video). Defaults to the Phone-X unavailable state. */
  children?: React.ReactNode;
}) {
  return (
    <aside
      className={`osiris__cctv-detail${compact ? " osiris__cctv-detail--compact" : ""}`}
      aria-label="CCTV detail"
    >
      <header className="osiris__cctv-detail-header">
        <div title={`${camera.name} · ${camera.sourceName}`}>
          <strong>{camera.name}</strong>
          <span>{camera.sourceName}</span>
        </div>
        <small
          className="osiris__cctv-coordinates"
          aria-label={`Lat/Lon: ${coordinatesLine(camera)}`}
          title={`Lat/Lon: ${coordinatesLine(camera)}`}
        >
          {coordinatesLine(camera)}
        </small>
        <button type="button" title="Tutup detail CCTV" onClick={onClose}>
          x
        </button>
      </header>
      <p className="osiris__cctv-detail-source">{statusLine(camera, compact)}</p>
      {children ?? (
        <div className="osiris__cctv-unavailable" role="status">
          SOURCE TIDAK MERESPONS PADA SNAPSHOT TERAKHIR
        </div>
      )}
    </aside>
  );
}

/* ─────────────────────────── HLS player (Nr parity) ─────────────────────────── */

export interface DirectSource {
  url: string;
  type: "hls" | "mp4";
  hlsAllowed?: boolean;
}

export interface PlaybackInfo {
  mode: "direct" | "relay";
  state: "loading" | "playing" | "failed";
  directKind?: string;
}

export function HlsPlayer({
  id,
  name,
  directSources,
  relayUrl,
  onPlayback,
  failureMessage,
}: {
  id: string;
  name: string;
  directSources?: DirectSource[];
  relayUrl?: string;
  onPlayback?: (info: PlaybackInfo) => void;
  failureMessage?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onPlaybackRef = useRef(onPlayback);
  onPlaybackRef.current = onPlayback;
  const [retryState, setRetryState] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const nativeHls = !!video.canPlayType("application/vnd.apple.mpegurl");
    const sources = (directSources ?? []).filter(
      (s) => s.type === "mp4" || nativeHls || s.hlsAllowed,
    );

    let sourceIndex = 0;
    let stopped = false;
    let generation = 0;
    let relayFailures = 0;
    let teardown: () => void = () => {};
    let retryTimer: ReturnType<typeof setTimeout>;
    let watchdog: ReturnType<typeof setInterval>;

    const attempt = (mode: "direct" | "relay") => {
      teardown();
      clearTimeout(retryTimer);
      if (stopped) return;
      const gen = ++generation;
      const source = mode === "direct" ? sources[sourceIndex] : undefined;
      const notify = (state: PlaybackInfo["state"]) =>
        onPlaybackRef.current?.({
          mode,
          state,
          ...(source ? { directKind: source.type } : {}),
        });

      let played = false;
      let settled = false;
      let hls: Hls | undefined;
      let lastTime = 0;
      let lastFrames = 0;
      let lastProgress = performance.now();

      const isCurrent = () => !stopped && !settled && generation === gen;
      const cleanup = () => {
        settled = true;
        clearTimeout(retryTimer);
        clearInterval(watchdog);
        video.removeEventListener("error", onError);
        video.removeEventListener("ended", onError);
        hls?.destroy();
        hls = undefined;
        video.pause();
        video.removeAttribute("src");
        video.srcObject = null;
        video.load();
      };
      const onError = () => {
        if (!isCurrent()) return;
        cleanup();
        if (mode === "direct") {
          relayFailures = 0;
          sourceIndex += 1;
          attempt(sourceIndex < sources.length ? "direct" : "relay");
          return;
        }
        notify("failed");
        if (relayFailures < 2) {
          relayFailures += 1;
          setRetryState("retrying");
          retryTimer = setTimeout(() => attempt("relay"), 60_000);
        } else {
          setRetryState("stopped");
        }
      };

      teardown = cleanup;
      setRetryState(null);
      notify("loading");
      video.addEventListener("error", onError);
      video.addEventListener("ended", onError);

      retryTimer = setTimeout(onError, mode === "direct" ? 12_000 : 25_000);
      watchdog = setInterval(() => {
        if (!isCurrent() || video.paused) return;
        const frames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
        if (video.readyState >= 2 && video.videoWidth > 0 && (video.currentTime > lastTime || frames > lastFrames)) {
          lastProgress = performance.now();
          if (!played) {
            played = true;
            notify("playing");
          }
        } else if (played && performance.now() - lastProgress >= 20_000) {
          onError();
        }
        lastTime = video.currentTime;
        lastFrames = frames;
      }, 1000);

      const url = source?.url ?? relayUrl ?? "";
      const play = () => {
        video.play().catch((err) => {
          if (isCurrent() && err?.name === "NotAllowedError") clearTimeout(retryTimer);
        });
      };

      if (source && (source.type === "mp4" || nativeHls)) {
        video.src = url;
        video.load();
        play();
      } else if (Hls.isSupported()) {
        hls = new Hls({
          autoStartLoad: true,
          backBufferLength: 5,
          enableWorker: true,
          maxBufferLength: 20,
          maxMaxBufferLength: 30,
          manifestLoadPolicy: {
            default: { maxTimeToFirstByteMs: 8_000, maxLoadTimeMs: 10_000, timeoutRetry: null, errorRetry: null },
          },
          playlistLoadPolicy: {
            default: { maxTimeToFirstByteMs: 8_000, maxLoadTimeMs: 10_000, timeoutRetry: null, errorRetry: null },
          },
          fragLoadPolicy: {
            default: { maxTimeToFirstByteMs: 10_000, maxLoadTimeMs: 20_000, timeoutRetry: null, errorRetry: null },
          },
        });
        hls.on(Hls.Events.MANIFEST_PARSED, play);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) onError();
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (nativeHls) {
        video.src = url;
        video.load();
        play();
      } else {
        onError();
      }
    };

    attempt(sources.length ? "direct" : "relay");
    return () => {
      stopped = true;
      generation += 1;
      clearTimeout(retryTimer);
      teardown();
    };
  }, [id, directSources, relayUrl]);

  return (
    <>
      <div className="osiris__cctv-player" style={retryState ? { display: "none" } : undefined}>
        <video ref={videoRef} muted autoPlay playsInline controls aria-label={`${name} live CCTV`} />
      </div>
      {retryState && (
        <div className="osiris__cctv-unavailable" role="status">
          {failureMessage ??
            (retryState === "retrying"
              ? "Sumber sementara tidak tersedia · mencoba kembali otomatis"
              : "Sumber sementara tidak dapat diputar")}
        </div>
      )}
    </>
  );
}

/* ─────────────────────────── youtube player ─────────────────────────── */

export function YoutubePlayer({ camera }: { camera: PolarisCamera }) {
  if (!camera.embedUrl) {
    return (
      <div className="osiris__cctv-unavailable" role="status">
        SOURCE TIDAK MERESPONS PADA SNAPSHOT TERAKHIR
      </div>
    );
  }
  return (
    <div className="osiris__cctv-player">
      <iframe
        src={camera.embedUrl}
        title={`${camera.name} live CCTV`}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}

/* ─────────────────────────── player router (Qs parity) ─────────────────────────── */

/** Phone-X relay paths are rewritten to the Hamsa relay endpoint. */
export function hamsaRelayUrl(relayPlaylistUrl?: string): string | undefined {
  if (!relayPlaylistUrl) return undefined;
  return relayPlaylistUrl.replace(/^\/api\/osiris\/cctv\//, "/api/v1/osiris/cctv/");
}

export function PlayerRouter({
  camera,
  compact,
  onClose,
  onPlayback,
}: {
  camera: PolarisCamera;
  compact?: boolean;
  onClose: () => void;
  onPlayback?: (info: PlaybackInfo) => void;
}) {
  if (camera.streamKind === "youtube" && camera.embedUrl) {
    return (
      <CameraDetail camera={camera} onClose={onClose} compact={compact}>
        <YoutubePlayer camera={camera} />
      </CameraDetail>
    );
  }
  if (camera.streamKind === "ponorogo-mse") {
    return (
      <CameraDetail camera={camera} onClose={onClose} compact={compact}>
        <div className="osiris__cctv-unavailable" role="status">
          PENDING · sumber kamera belum menyediakan video yang dapat diputar
        </div>
      </CameraDetail>
    );
  }
  const directSources: DirectSource[] = camera.directPlaylistUrl
    ? [{ url: camera.directPlaylistUrl, type: "hls", hlsAllowed: true }]
    : [];
  return (
    <CameraDetail camera={camera} onClose={onClose} compact={compact}>
      <HlsPlayer
        id={camera.id}
        name={camera.name}
        directSources={directSources}
        relayUrl={hamsaRelayUrl(camera.relayPlaylistUrl)}
        onPlayback={onPlayback}
      />
    </CameraDetail>
  );
}
