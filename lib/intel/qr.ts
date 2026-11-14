import type { ModuleResult } from "./types";

/**
 * Barcode/QR decoding with zxing-wasm (the same engine Phone-X ships).
 *
 * The wasm bundle is loaded lazily so a cold import cannot slow the console,
 * and every failure path returns a readable warning instead of a 500.
 */

export interface QrDecodeResult {
  decoded: string | null;
  format: string | null;
  text: string | null;
  bytes: number | null;
  warnings: string[];
}

export function parseDataUrl(input: string): { data: Uint8Array; mime: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(input.trim());
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const payload = match[3];
  try {
    if (match[2]) return { data: new Uint8Array(Buffer.from(payload, "base64")), mime };
    return { data: new Uint8Array(Buffer.from(decodeURIComponent(payload), "binary")), mime };
  } catch {
    return null;
  }
}

export async function decodeQr(input: string): Promise<QrDecodeResult> {
  const warnings: string[] = [];
  const parsed = parseDataUrl(input);
  const bytes = parsed?.data ?? new Uint8Array(Buffer.from(input, "base64"));
  if (bytes.byteLength === 0) {
    return { decoded: null, format: null, text: null, bytes: 0, warnings: ["Empty image payload."] };
  }
  if (bytes.byteLength > 8 * 1024 * 1024) {
    return { decoded: null, format: null, text: null, bytes: bytes.byteLength, warnings: ["Image exceeds 8 MB."] };
  }

  try {
    const { readBarcodes } = await import("zxing-wasm/reader");
    const results = await readBarcodes(bytes, {
      formats: ["QRCode", "DataMatrix", "Aztec", "PDF417", "EAN13", "Code128", "Code39"],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
    });
    const hit = results.find((r) => r.isValid && r.text);
    if (!hit) {
      return {
        decoded: null,
        format: null,
        text: null,
        bytes: bytes.byteLength,
        warnings: ["No barcode detected in the image."],
      };
    }
    if (hit.text.startsWith("http")) {
      warnings.push("Decoded payload is a URL — fetch it only through an isolated browser profile.");
    }
    return {
      decoded: hit.text,
      format: hit.format ?? null,
      text: hit.text,
      bytes: hit.bytes?.length ?? bytes.byteLength,
      warnings,
    };
  } catch (err) {
    return {
      decoded: null,
      format: null,
      text: null,
      bytes: bytes.byteLength,
      warnings: [`Decoder unavailable: ${(err as Error).message}`],
    };
  }
}

/** Charges and history-wraps the decode so it shows up like every other module. */
export async function investigateQr(input: string): Promise<ModuleResult> {
  const started = Date.now();
  const result = await decodeQr(input);
  const warnings = [...result.warnings];

  return {
    module: "public-evidence",
    target: "[qr image]",
    durationMs: Date.now() - started,
    sources: [{ name: "zxing-wasm (offline decoder)", kind: "offline" }],
    signals: result.decoded
      ? [{ label: `Decoded ${result.format ?? "barcode"} payload`, level: "info" }]
      : [{ label: "No barcode decoded", level: "low" }],
    data: {
      decoded: result.decoded,
      format: result.format,
      bytes: result.bytes,
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
