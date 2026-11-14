import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { ModuleResult, Signal, SourceRef } from "./types";

/**
 * HUMINT records — the analyst's own harvested notes.
 *
 * Phone-X accepts a `.json` harvester dump whose records are matched against the
 * target number. Hamsa reads the same shape from two places:
 *
 *  1. the `keyword` argument, when it contains a JSON payload (paste-in path),
 *  2. `HAMSA_HUMINT_DIR`, a directory of `*.json` dumps (drop-in path).
 *
 * Accepted record shapes:
 *   { "number" | "phone" | "msisdn": "+62...", "content": "...", "source": "..." }
 * and the flat Phone-X text block where records are separated by `---` lines.
 */

export interface HumintRecord {
  recordNumber: string | null;
  phone: string | null;
  content: string;
  source: string | null;
}

interface RawRecord {
  number?: unknown;
  phone?: unknown;
  msisdn?: unknown;
  content?: unknown;
  text?: unknown;
  source?: unknown;
  recordNumber?: unknown;
}

function asRecords(payload: unknown): HumintRecord[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { records?: unknown }).records)
      ? (payload as { records: unknown[] }).records
      : [];
  return list
    .filter((r): r is RawRecord => Boolean(r) && typeof r === "object")
    .map((r) => ({
      recordNumber: typeof r.recordNumber === "string" ? r.recordNumber : null,
      phone: String(r.number ?? r.phone ?? r.msisdn ?? "").trim() || null,
      content: String(r.content ?? r.text ?? "").trim(),
      source: typeof r.source === "string" ? r.source : null,
    }))
    .filter((r) => r.content.length > 0);
}

function parseTextBlock(text: string): HumintRecord[] {
  return text
    .split(/^\s*---+\s*$/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const number = /(?:\+?\d[\d\s().-]{6,}\d)/.exec(chunk)?.[0] ?? null;
      return {
        recordNumber: null,
        phone: number ? number.replace(/[^\d+]/g, "") : null,
        content: chunk,
        source: null,
      };
    });
}

function matches(record: HumintRecord, digits: string): boolean {
  if (!record.phone) return false;
  const normal = record.phone.replace(/[^\d]/g, "");
  return normal.endsWith(digits) || digits.endsWith(normal);
}

export async function investigateHumint(
  raw: string,
  keyword = "",
  defaultCountry = "ID",
): Promise<ModuleResult> {
  const started = Date.now();
  const sources: SourceRef[] = [];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry as never);
  const e164 = parsed?.number ?? raw.trim();
  const digits = e164.replace(/[^\d]/g, "");

  const records: HumintRecord[] = [];

  // 1) Inline payload.
  const paste = keyword.trim();
  if (paste) {
    try {
      records.push(...asRecords(JSON.parse(paste)));
      sources.push({ name: "Inline HUMINT payload", kind: "derived" });
    } catch {
      const textRecords = parseTextBlock(paste);
      if (textRecords.length) {
        records.push(...textRecords);
        sources.push({ name: "Inline HUMINT text block", kind: "derived" });
      } else {
        warnings.push("keyword was neither valid JSON nor a `---`-separated record block.");
      }
    }
  }

  // 2) Directory of dumps.
  const dir = process.env.HAMSA_HUMINT_DIR?.trim();
  if (dir) {
    try {
      const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".json"));
      for (const file of files.slice(0, 200)) {
        const text = await readFile(path.join(dir, file), "utf8");
        try {
          records.push(...asRecords(JSON.parse(text)));
        } catch {
          warnings.push(`Skipped unparseable HUMINT file: ${file}`);
        }
      }
      sources.push({ name: `HUMINT directory (${files.length} file(s))`, kind: "derived" });
    } catch (err) {
      warnings.push(`HAMSA_HUMINT_DIR could not be read: ${(err as Error).message}`);
    }
  }

  if (!paste && !dir) {
    warnings.push(
      "No HUMINT source configured. Pass a JSON dump as the keyword argument or set HAMSA_HUMINT_DIR to a folder of harvester dumps.",
    );
    signals.push({ label: "No HUMINT corpus available", level: "low" });
  }

  const hits = records.filter((r) => matches(r, digits));
  if (hits.length) {
    signals.push({ label: `${hits.length} HUMINT record(s) mention this number`, level: "high" });
  } else if (records.length) {
    signals.push({ label: `No mention across ${records.length} scanned record(s)`, level: "info" });
  }

  return {
    module: "humint",
    target: e164,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      found: hits.length > 0,
      scanned: records.length,
      count: hits.length,
      records: hits.map((r) => ({
        recordNumber: r.recordNumber,
        content: r.content.slice(0, 4000),
        source: r.source,
      })),
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
