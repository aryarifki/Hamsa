"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { CopyButton } from "@/components/DataView";

interface DecodeResponse {
  cost: number;
  decoded: string | null;
  format: string | null;
  bytes: number | null;
  warnings: string[];
}

export default function QrPage() {
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DecodeResponse | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setData(null);
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!preview || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: preview }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setData(json as DecodeResponse);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="rise">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-brass/30 bg-brass/8 text-brass">
            <Icon name="search" size={17} />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">QR / barcode decoder</h1>
            <p className="text-[12px] text-muted">
              Offline decode with zxing-wasm: QR, DataMatrix, Aztec, PDF417, EAN-13, Code 128, Code 39.
            </p>
          </div>
          <span className="badge badge-brass mono ml-auto shrink-0">2 credits</span>
        </div>
      </header>

      <section className="card card-pad rise space-y-4">
        <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
          <div className="grid h-[200px] place-items-center rounded-xl border border-dashed border-line bg-surface-2/40">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Selected image" className="max-h-[180px] max-w-[200px] object-contain" />
            ) : (
              <p className="px-4 text-center text-[11.5px] text-faint">PNG or JPG screenshot of a barcode</p>
            )}
          </div>
          <div className="space-y-3">
            <label className="btn btn-primary inline-flex cursor-pointer items-center gap-2">
              <Icon name="plus" size={14} />
              Choose image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            <button type="button" className="btn ml-2" onClick={submit} disabled={!preview || pending}>
              {pending ? "Decoding…" : "Decode"}
            </button>
            <p className="text-[11px] text-faint">
              Images are decoded in-process and never written to disk or sent to a third party.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-bad/30 bg-bad/8 px-4 py-3 text-[12.5px] text-bad">{error}</div>
        )}

        {data && (
          <div className="space-y-3 border-t border-line-soft pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${data.decoded ? "badge-good" : "badge-brass"}`}>
                {data.decoded ? `${data.format ?? "barcode"} decoded` : "no barcode found"}
              </span>
              {data.bytes !== null && <span className="text-[11px] text-faint">{data.bytes} bytes</span>}
              {data.decoded && <CopyButton value={data.decoded} />}
            </div>
            {data.decoded && (
              <pre className="mono max-h-64 overflow-auto rounded-lg border border-line bg-surface-2/60 p-3 text-[12px] text-text">
                {data.decoded}
              </pre>
            )}
            {data.warnings.length > 0 && (
              <ul className="space-y-1 text-[12px] text-warn">
                {data.warnings.map((w, i) => (
                  <li key={i}>· {w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
