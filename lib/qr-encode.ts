import qrcode from "qrcode-generator";

/**
 * QR rendering for payment payloads.
 *
 * Kept in one place so the only QR *encoder* in the tree is this wrapper: the
 * reader lives in `lib/intel/qr.ts` (zxing-wasm) and the two must not be
 * confused. SVG is returned as a string so the client can inline it without a
 * second request or a binary endpoint.
 *
 * `qrcode-generator` is pure JS with no runtime dependencies; the byte-mode
 * default covers EMVCo payloads and any URL.
 */
export function qrSvg(data: string, opts: { cellSize?: number; margin?: number } = {}): string | null {
  const payload = data.trim();
  if (!payload) return null;
  try {
    const qr = qrcode(0, "M");
    qr.addData(payload, "Byte");
    qr.make();
    return qr.createSvgTag({
      cellSize: opts.cellSize ?? 5,
      margin: opts.margin ?? 4,
      scalable: true,
    });
  } catch {
    return null;
  }
}
