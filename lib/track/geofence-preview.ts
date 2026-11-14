/**
 * Minimal EXIF GPS reader for the chain preview.
 *
 * Phone-X accepts an image and returns the geofence encoded in it. The honest
 * native equivalent is: pull the GPS tag if the file carries one, and say
 * plainly when it does not — no OCR, no guessing a location from pixels.
 *
 * Only JPEG APP1/TIFF is parsed, which is what phone cameras and map
 * screenshots that embed a location actually produce.
 */

export interface ExifGps {
  found: boolean;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  takenAt: string | null;
  warnings: string[];
}

const EMPTY: ExifGps = { found: false, lat: null, lon: null, altitude: null, takenAt: null, warnings: [] };

function readUInt(buffer: Buffer, offset: number, size: number, little: boolean): number {
  if (offset + size > buffer.length) throw new Error("Truncated EXIF");
  return size === 2
    ? little
      ? buffer.readUInt16LE(offset)
      : buffer.readUInt16BE(offset)
    : little
      ? buffer.readUInt32LE(offset)
      : buffer.readUInt32BE(offset);
}

function readRational(buffer: Buffer, offset: number, little: boolean): number {
  const numerator = readUInt(buffer, offset, 4, little);
  const denominator = readUInt(buffer, offset + 4, 4, little);
  return denominator === 0 ? 0 : numerator / denominator;
}

function dmsToDecimal(dms: number[], ref: string): number {
  const [d = 0, m = 0, s = 0] = dms;
  const value = d + m / 60 + s / 3600;
  return /S|W/i.test(ref) ? -value : value;
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
  entryOffset: number;
}

function readIfd(buffer: Buffer, offset: number, little: boolean): Map<number, IfdEntry> {
  const entries = new Map<number, IfdEntry>();
  const count = readUInt(buffer, offset, 2, little);
  for (let i = 0; i < count; i += 1) {
    const entryOffset = offset + 2 + i * 12;
    if (entryOffset + 12 > buffer.length) break;
    const tag = readUInt(buffer, entryOffset, 2, little);
    const type = readUInt(buffer, entryOffset + 2, 2, little);
    const valueCount = readUInt(buffer, entryOffset + 4, 4, little);
    entries.set(tag, {
      tag,
      type,
      count: valueCount,
      valueOffset: entryOffset + 8,
      entryOffset,
    });
  }
  return entries;
}

/** Where the value lives: inline when ≤4 bytes, otherwise at the pointer. */
function valueStart(buffer: Buffer, entry: IfdEntry, little: boolean): number {
  const size =
    entry.type === 3 ? 2 : entry.type === 4 ? 4 : entry.type === 5 ? 8 : 1;
  const bytes = size * entry.count;
  return bytes <= 4 ? entry.valueOffset : readUInt(buffer, entry.valueOffset, 4, little);
}

function ascii(buffer: Buffer, entry: IfdEntry, little: boolean): string {
  const start = valueStart(buffer, entry, little);
  return buffer.subarray(start, start + entry.count).toString("ascii").replace(/\0.*$/, "").trim();
}

function rationals(buffer: Buffer, entry: IfdEntry, little: boolean): number[] {
  const start = valueStart(buffer, entry, little);
  const out: number[] = [];
  for (let i = 0; i < Math.min(entry.count, 3); i += 1) {
    out.push(readRational(buffer, start + i * 8, little));
  }
  return out;
}

export function extractExifGps(bytes: Buffer): ExifGps {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { ...EMPTY, warnings: ["Not a JPEG — no EXIF block to read."] };
  }

  // Walk JPEG segments looking for APP1/Exif.
  let cursor = 2;
  let tiff: Buffer | null = null;
  while (cursor + 4 <= bytes.length) {
    if (bytes[cursor] !== 0xff) break;
    const marker = bytes[cursor + 1];
    const length = bytes.readUInt16BE(cursor + 2);
    if (marker === 0xe1) {
      const header = bytes.subarray(cursor + 4, cursor + 10).toString("binary");
      if (header.startsWith("Exif\0\0")) {
        tiff = bytes.subarray(cursor + 10, cursor + 2 + length);
        break;
      }
    }
    if (marker === 0xda) break; // start of scan: no more metadata
    cursor += 2 + length;
  }

  if (!tiff || tiff.length < 8) {
    return { ...EMPTY, warnings: ["No EXIF block found in the uploaded image."] };
  }

  try {
    const order = tiff.subarray(0, 2).toString("ascii");
    const little = order === "II";
    if (!little && order !== "MM") {
      return { ...EMPTY, warnings: ["Unrecognised TIFF byte order."] };
    }
    if (readUInt(tiff, 2, 2, little) !== 0x2a) {
      return { ...EMPTY, warnings: ["Not a TIFF/EXIF payload."] };
    }

    const ifd0Offset = readUInt(tiff, 4, 4, little);
    const ifd0 = readIfd(tiff, ifd0Offset, little);

    const gpsPointer = ifd0.get(0x8825);
    if (!gpsPointer) {
      return { ...EMPTY, warnings: ["EXIF present but no GPS IFD — the image carries no coordinates."] };
    }

    const gpsOffset = readUInt(tiff, gpsPointer.valueOffset, 4, little);
    const gps = readIfd(tiff, gpsOffset, little);

    const latEntry = gps.get(0x0002);
    const lonEntry = gps.get(0x0004);
    if (!latEntry || !lonEntry) {
      return { ...EMPTY, warnings: ["GPS IFD has no latitude/longitude pair."] };
    }

    const latRef = gps.has(0x0001) ? ascii(tiff, gps.get(0x0001)!, little) : "N";
    const lonRef = gps.has(0x0003) ? ascii(tiff, gps.get(0x0003)!, little) : "E";
    const lat = dmsToDecimal(rationals(tiff, latEntry, little), latRef);
    const lon = dmsToDecimal(rationals(tiff, lonEntry, little), lonRef);

    let altitude: number | null = null;
    const altEntry = gps.get(0x0006);
    if (altEntry) {
      const values = rationals(tiff, altEntry, little);
      if (values.length) altitude = values[0];
      const refEntry = gps.get(0x0005);
      if (refEntry && ascii(tiff, refEntry, little) === "1" && altitude !== null) altitude = -altitude;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
      return { ...EMPTY, warnings: ["GPS tags were present but did not decode to a usable coordinate."] };
    }

    return {
      found: true,
      lat,
      lon,
      altitude,
      takenAt: null,
      warnings: [],
    };
  } catch (err) {
    return { ...EMPTY, warnings: [`EXIF parse failed: ${(err as Error).message}`] };
  }
}

/** Accepts a data URL or bare base64 string, as Phone-X's preview endpoint does. */
export function decodeImagePayload(input: string): Buffer | null {
  const trimmed = input.trim();
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(trimmed);
  try {
    if (match) {
      if (match[2]) return Buffer.from(match[3], "base64");
      return Buffer.from(decodeURIComponent(match[3]), "binary");
    }
    return Buffer.from(trimmed, "base64");
  } catch {
    return null;
  }
}
