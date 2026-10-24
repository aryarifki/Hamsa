/**
 * Baseline PostgreSQL schema — the structure v1 of Hamsa shipped with.
 *
 * A fresh install runs this first and then replays `lib/migrations.ts`, so a
 * new database and an upgrade converge on the same shape through one code
 * path. Timestamps are `timestamptz` (parsed back to ISO strings in `db.ts`)
 * and 0/1 flags stay integers, matching the application's existing checks.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'analyst',
  status        TEXT NOT NULL DEFAULT 'active',
  credits       INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL,
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  revoked_at TIMESTAMPTZ
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
  created_at    TIMESTAMPTZ NOT NULL
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
  created_at  TIMESTAMPTZ NOT NULL,
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
  created_at        TIMESTAMPTZ NOT NULL,
  closed_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cases_user ON cases(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS case_items (
  case_id   TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  lookup_id TEXT NOT NULL REFERENCES lookups(id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL,
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
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL DEFAULT 'lookup',
  created_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS providers (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  config     TEXT,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_kind_name ON providers(kind, name);

CREATE TABLE IF NOT EXISTS watchlist (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module         TEXT NOT NULL,
  target         TEXT NOT NULL,
  interval_hours INTEGER NOT NULL DEFAULT 24,
  active         INTEGER NOT NULL DEFAULT 1,
  last_run_at    TIMESTAMPTZ,
  last_status    TEXT,
  last_result    TEXT,
  created_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_user ON watchlist(user_id);

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  consent_ref   TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ,
  last_lat      DOUBLE PRECISION,
  last_lng      DOUBLE PRECISION,
  last_accuracy DOUBLE PRECISION,
  last_battery  DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS geofences (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  radius_m   INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS device_pings (
  id        TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  lat       DOUBLE PRECISION NOT NULL,
  lng       DOUBLE PRECISION NOT NULL,
  accuracy  DOUBLE PRECISION,
  battery   DOUBLE PRECISION,
  at        TIMESTAMPTZ NOT NULL
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
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_sources (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel        TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  last_synced_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
