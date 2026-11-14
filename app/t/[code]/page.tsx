"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface ChainInfo {
  code: string;
  label: string;
  open: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export default function TangoChainPage() {
  const params = useParams<{ code: string }>();
  const code = String(params?.code ?? "").toUpperCase();

  const [info, setInfo] = useState<ChainInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/geofint/chains/${encodeURIComponent(code)}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Chain not found");
        setInfo(body as ChainInfo);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  function submit() {
    if (!navigator.geolocation) {
      setError("This browser does not expose geolocation.");
      return;
    }
    setPending(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const tokenRes = await fetch("/api/v1/geofint/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          const tokenBody = await tokenRes.json().catch(() => ({}));
          if (!tokenRes.ok) throw new Error(tokenBody.error ?? "Could not open a reporting session");

          const res = await fetch(`/api/v1/geofint/chains/${encodeURIComponent(code)}/reports`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-geofint-token": tokenBody.token as string,
            },
            body: JSON.stringify({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
              note: note.trim() || null,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ?? "Report was rejected");

          setSent({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          });
          setNote("");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setPending(false);
        }
      },
      (geoError) => {
        setPending(false);
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location permission was denied. Nothing was sent."
            : geoError.message || "Could not read your position.",
        );
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[520px] flex-col justify-center px-5 py-10">
      <div className="card card-pad space-y-5">
        <header className="space-y-1.5">
          <p className="eyebrow">Tango chain</p>
          <h1 className="text-[19px] font-semibold tracking-tight">{info?.label ?? "Shared location request"}</h1>
          <p className="text-[12px] leading-relaxed text-muted">
            An investigator asked you to share your current position through this link. Submitting is voluntary:
            your coordinates, accuracy and any note you add are sent to the operator of this chain.
          </p>
        </header>

        {!info && !error && <p className="text-[12.5px] text-muted">Checking the chain…</p>}

        {info && (
          <dl className="grid grid-cols-2 gap-2 text-[11.5px]">
            <dt className="text-faint">Code</dt>
            <dd className="mono text-text">{info.code}</dd>
            <dt className="text-faint">Status</dt>
            <dd className={info.open ? "text-good" : "text-bad"}>{info.open ? "open" : "closed"}</dd>
            <dt className="text-faint">Expires</dt>
            <dd className="text-muted">{info.expiresAt ? new Date(info.expiresAt).toLocaleString() : "no expiry"}</dd>
          </dl>
        )}

        {info?.open && !sent && (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-[11px] uppercase tracking-[0.12em] text-faint">Note (optional)</span>
              <input
                className="input w-full"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder="Where you are, or why you are sharing"
              />
            </label>
            <button type="button" className="btn btn-primary w-full" onClick={submit} disabled={pending}>
              {pending ? "Sending…" : "Share my current position"}
            </button>
            <p className="text-[11px] text-faint">
              The browser asks for permission first. If you deny it, nothing is transmitted.
            </p>
          </div>
        )}

        {sent && (
          <div className="space-y-2 rounded-xl border border-good/30 bg-good/8 px-4 py-3">
            <p className="text-[12.5px] text-good">Position sent.</p>
            <p className="mono text-[11.5px] text-muted">
              {sent.lat.toFixed(6)}, {sent.lng.toFixed(6)}
              {sent.accuracy !== null ? ` · ±${Math.round(sent.accuracy)} m` : ""}
            </p>
            <a
              className="text-[11.5px] text-brass underline decoration-line"
              href={`https://www.openstreetmap.org/?mlat=${sent.lat}&mlon=${sent.lng}#map=17/${sent.lat}/${sent.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              View on OpenStreetMap
            </a>
            <button type="button" className="btn mt-2 w-full" onClick={() => setSent(null)}>
              Send another update
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-bad/30 bg-bad/8 px-4 py-3 text-[12.5px] text-bad">{error}</div>
        )}

        <footer className="border-t border-line-soft pt-3 text-[10.5px] leading-relaxed text-faint">
          Hamsa records the time, your submitted coordinates and accuracy, and the network address the request came
          from. Ask the investigator how they will use it before you submit.
        </footer>
      </div>
    </div>
  );
}
