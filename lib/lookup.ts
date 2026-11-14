import { all, newId, now, one, run } from "./db";
import { audit } from "./audit";
import { costOf, charge, refund, type ModuleKey } from "./tokens";
import { investigatePhone } from "./intel/phone";
import { investigateIp } from "./intel/ip";
import { investigateEmail } from "./intel/email";
import { investigateUsername } from "./intel/username";
import { investigateTelegram } from "./intel/telegram";
import { investigateHlr } from "./intel/hlr";
import { investigateWhatsApp } from "./intel/whatsapp";
import { investigateGetContact } from "./intel/getcontact";
import { investigateEwallet } from "./intel/ewallet";
import { investigateBreach } from "./intel/breach";
import { investigateHumint } from "./intel/humint";
import { investigatePublicEvidence } from "./intel/public-evidence";
import { investigateName } from "./intel/name";
import { investigateDomain } from "./intel/domain";
import { investigateTelegramAnalytics } from "./intel/telegram-analytics";
import type { ModuleResult } from "./intel/types";
import type { User } from "./users";
import { isIP } from "node:net";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export interface LookupInput {
  user: User;
  module: ModuleKey;
  target: string;
  keyword?: string;
  caseId?: string;
  ip?: string;
  userAgent?: string;
}

export interface LookupRecord {
  id: string;
  user_id: string;
  module: ModuleKey;
  target: string;
  status: "ok" | "error";
  cost: number;
  provider: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
  duration_ms: number | null;
}

export class LookupError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function dispatch(input: LookupInput): Promise<ModuleResult> {
  switch (input.module) {
    case "phone":
      return investigatePhone(input.target);
    case "ip":
      return investigateIp(input.target);
    case "email":
      return investigateEmail(input.target);
    case "username":
      return investigateUsername(input.target);
    case "telegram":
      return investigateTelegram(input.target, input.keyword ?? "");
    case "hlr":
      return investigateHlr(input.target);
    case "whatsapp":
      return investigateWhatsApp(input.target);
    case "getcontact":
      return investigateGetContact(input.target);
    case "ewallet":
      return investigateEwallet(input.target);
    case "breach":
      return investigateBreach(input.target);
    case "humint":
      return investigateHumint(input.target, input.keyword ?? "");
    case "public-evidence":
      return investigatePublicEvidence(input.target);
    case "name":
      return investigateName(input.target, input.keyword ?? "");
    case "domain":
      return investigateDomain(input.target);
    case "telegram-analytics":
      return investigateTelegramAnalytics(input.target);
    default:
      throw new LookupError(400, "Unknown module");
  }
}

const PHONE_MODULES: ModuleKey[] = ["phone", "hlr", "whatsapp", "getcontact", "ewallet", "humint"];

function validateTarget(module: ModuleKey, target: string): void {
  if (module === "ip" && isIP(target) === 0) throw new LookupError(400, "Invalid IP address");
  if (module === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(target)) {
    throw new LookupError(400, "Invalid email address");
  }
  if (module === "username" && !/^[a-zA-Z0-9._-]{1,64}$/.test(target.replace(/^@/, ""))) {
    throw new LookupError(400, "Invalid username");
  }
  if ((module === "telegram" || module === "telegram-analytics") && !/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(target.replace(/^@/, "").replace(/^https?:\/\/t\.me\/(s\/)?/, ""))) {
    throw new LookupError(400, "Invalid Telegram channel");
  }
  if (PHONE_MODULES.includes(module)) {
    const parsed = parsePhoneNumberFromString(target, "ID");
    if (!parsed || !parsed.isPossible()) throw new LookupError(400, "Invalid phone number");
  }
  if (module === "breach") {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(target);
    if (!isEmail) {
      const parsed = parsePhoneNumberFromString(target, "ID");
      if (!parsed || !parsed.isPossible()) throw new LookupError(400, "Provide a phone number or email address");
    }
  }
  if (module === "public-evidence" && !/^\+?\d[\d\s().-]{5,}$/.test(target) && !/^@?[a-zA-Z0-9._-]{2,64}$/.test(target)) {
    throw new LookupError(400, "Provide a phone number or handle");
  }
  if (module === "name" && target.trim().length < 2) {
    throw new LookupError(400, "Name is too short");
  }
  if (module === "domain" && !/^(?=.{4,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(target.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))) {
    throw new LookupError(400, "Invalid domain");
  }
}

export async function runLookup(input: LookupInput) {
  if (input.user.role === "viewer") {
    throw new LookupError(403, "Viewer accounts cannot run lookups");
  }

  const target = input.target.trim();
  if (!target) throw new LookupError(400, "Target is required");
  if (target.length > 320) throw new LookupError(400, "Target is too long");
  validateTarget(input.module, target);

  if (input.caseId) {
    const owned = await one<{ id: string }>(
      "SELECT id FROM cases WHERE id = ? AND user_id = ?",
      input.caseId,
      input.user.id,
    );
    if (!owned) throw new LookupError(404, "Case not found");
  }

  const cost = costOf(input.module);
  const balance = await charge(input.user.id, cost, `lookup:${input.module}`, "lookup");
  const id = newId();
  const startedAt = Date.now();

  await run(
    `INSERT INTO lookups (id, user_id, module, target, status, cost, created_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
    id,
    input.user.id,
    input.module,
    target,
    cost,
    now(),
  );

  try {
    const result = await dispatch(input);
    const duration = Date.now() - startedAt;
    await run(
      "UPDATE lookups SET status = 'ok', provider = ?, result = ?, duration_ms = ? WHERE id = ?",
      result.sources.filter((s) => s.kind === "provider" || s.kind === "public-api").map((s) => s.name).join(", ") || null,
      JSON.stringify(result),
      duration,
      id,
    );

    if (input.caseId) {
      await run(
        "INSERT INTO case_items (case_id, lookup_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        input.caseId,
        id,
        now(),
      );
    }

    await audit({
      userId: input.user.id,
      actor: input.user.email,
      action: "lookup.run",
      entity: "lookup",
      entityId: id,
      meta: { module: input.module, target, cost, caseId: input.caseId ?? null },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { id, module: input.module, target, cost, balance, durationMs: duration, result };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await run(
      "UPDATE lookups SET status = 'error', error = ?, duration_ms = ? WHERE id = ?",
      message,
      Date.now() - startedAt,
      id,
    );
    await refund(input.user.id, cost, "provider-failure", id);
    await audit({
      userId: input.user.id,
      actor: input.user.email,
      action: "lookup.denied",
      entity: "lookup",
      entityId: id,
      meta: { module: input.module, target, error: message },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    throw new LookupError(502, `Lookup failed and was refunded: ${message}`);
  }
}

export async function historyFor(userId: string, limit = 100): Promise<LookupRecord[]> {
  return all<LookupRecord>(
    `SELECT id, user_id, module, target, status, cost, provider, result, error, created_at, duration_ms
     FROM lookups WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId,
    limit,
  );
}

export async function lookupById(id: string, userId: string): Promise<LookupRecord | undefined> {
  return one<LookupRecord>("SELECT * FROM lookups WHERE id = ? AND user_id = ?", id, userId);
}

export function parsedResult(record: LookupRecord): ModuleResult | null {
  if (!record.result) return null;
  try {
    return JSON.parse(record.result) as ModuleResult;
  } catch {
    return null;
  }
}
