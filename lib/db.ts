import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * A single SQLite connection per process. Next.js dev mode re-evaluates modules
 * on every hot reload, so the handle is cached on globalThis to avoid leaking
 * file descriptors (and to keep WAL locks stable).
 */
declare global {
  // eslint-disable-next-line no-var
  var __hamsaDb: DatabaseSync | undefined;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'analyst',
  status        TEXT NOT NULL DEFAULT 'active',
  credits       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS ledger (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  ref_type      TEXT,
  ref_id        TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lookups (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module      TEXT NOT NULL,
  target      TEXT NOT NULL,
  status      TEXT NOT NULL,
  cost        INTEGER NOT NULL DEFAULT 0,
  provider    TEXT,
  result      TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lookups_user ON lookups(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lookups_module ON lookups(module, created_at DESC);

CREATE TABLE IF NOT EXISTS cases (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  title             TEXT NOT NULL,
  subject           TEXT,
  purpose           TEXT NOT NULL,
  authorization_ref TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  created_at        TEXT NOT NULL,
  closed_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_cases_user ON cases(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS case_items (
  case_id  TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  lookup_id TEXT NOT NULL REFERENCES lookups(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (case_id, lookup_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  actor      TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta       TEXT,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL DEFAULT 'lookup',
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE TABLE IF NOT EXISTS providers (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  config     TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module       TEXT NOT NULL,
  target       TEXT NOT NULL,
  interval_hours INTEGER NOT NULL DEFAULT 24,
  active       INTEGER NOT NULL DEFAULT 1,
  last_run_at  TEXT,
  last_status  TEXT,
  last_result  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_user ON watchlist(user_id);

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  consent_ref   TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT,
  last_lat      REAL,
  last_lng      REAL,
  last_accuracy REAL,
  last_battery  REAL
);

CREATE TABLE IF NOT EXISTS geofences (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  radius_m   INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_pings (
  id       TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  lat      REAL NOT NULL,
  lng      REAL NOT NULL,
  accuracy REAL,
  battery  REAL,
  at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pings_device ON device_pings(device_id, at DESC);

CREATE TABLE IF NOT EXISTS cctv_assets (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  protocol        TEXT NOT NULL DEFAULT 'rtsp',
  endpoint_enc    TEXT NOT NULL,
  username        TEXT,
  status          TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_sources (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel        TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function open(): DatabaseSync {
  const configured = process.env.HAMSA_DB_PATH;
  const file =
    configured === ":memory:"
      ? ":memory:"
      : configured
        ? resolve(/* turbopackIgnore: true */ configured)
        : resolve(process.cwd(), "data", "hamsa.db");
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const handle = new DatabaseSync(file);
  handle.exec(SCHEMA);
  return handle;
}

export const db: DatabaseSync = globalThis.__hamsaDb ?? (globalThis.__hamsaDb = open());

export const now = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();

/** Typed convenience wrappers around node:sqlite prepared statements. */
export function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
  return db.prepare(sql).run(...(params as never[])) as { changes: number; lastInsertRowid: number | bigint };
}

/** Runs fn inside a write transaction, rolling back on any throw. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getSetting(key: string, fallback = ""): string {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}
