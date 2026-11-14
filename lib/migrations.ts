import type { Db } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";

/**
 * Numbered, reversible migrations on PostgreSQL.
 *
 * The baseline in `schema.ts` is what v1 created; every change since lives
 * here. Each migration runs in its own transaction on a dedicated client, so
 * DDL and data copies commit or roll back together.
 *
 * `down` restores the previous structure and copies back every row that has a
 * representation in it. Rows that only exist because of the new schema (for
 * example an org-wide geofence, which v1 could not express) are dropped; the
 * loss is declared in `dataLoss` and printed by the CLI.
 */

export interface Migration {
  id: string;
  dataLoss?: string;
  up: (db: Db) => Promise<void>;
  down: (db: Db) => Promise<void>;
}

const nowIso = () => new Date().toISOString();

/* ─────────────────────────── 001 · notifications ─────────────────────────── */

const notifications: Migration = {
  id: "001_notifications",
  async up(db) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        title      TEXT NOT NULL,
        body       TEXT,
        entity     TEXT,
        entity_id  TEXT,
        read_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user
        ON notifications(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread
        ON notifications(user_id, read_at);
    `);
  },
  async down(db) {
    await db.exec("DROP TABLE IF EXISTS notifications;");
  },
};

/* ─────────────────────────── 002 · camera monitor ────────────────────────── */

interface LegacyAsset {
  id: string;
  user_id: string;
  name: string;
  protocol: string;
  endpoint_enc: string;
  username: string | null;
  status: string;
  last_checked_at: string | null;
  created_at: string;
}

const cameras: Migration = {
  id: "002_camera_monitor",
  dataLoss: "Snapshot files stay on disk after a rollback; only their metadata is dropped.",
  async up(db) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS cameras (
        id                   TEXT PRIMARY KEY,
        name                 TEXT NOT NULL,
        rtsp_url             TEXT NOT NULL DEFAULT '',
        onvif_host           TEXT,
        username_enc         TEXT,
        password_enc         TEXT,
        status               TEXT NOT NULL DEFAULT 'unknown',
        created_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
        snapshot_interval_s  INTEGER NOT NULL DEFAULT 300,
        motion_threshold     DOUBLE PRECISION,
        last_snapshot_at     TIMESTAMPTZ,
        last_error           TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        disabled_reason      TEXT,
        onvif_events_url     TEXT,
        onvif_sub_url        TEXT,
        onvif_sub_at         TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL,
        updated_at           TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cameras_creator ON cameras(created_by);
      CREATE INDEX IF NOT EXISTS idx_cameras_status ON cameras(status);

      CREATE TABLE IF NOT EXISTS camera_snapshots (
        id              TEXT PRIMARY KEY,
        camera_id       TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
        file_path       TEXT NOT NULL,
        bytes           INTEGER NOT NULL,
        motion_ratio    DOUBLE PRECISION,
        motion_detected INTEGER NOT NULL DEFAULT 0,
        captured_at     TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_camera_snapshots_camera
        ON camera_snapshots(camera_id, captured_at DESC);

      CREATE TABLE IF NOT EXISTS camera_events (
        id        TEXT PRIMARY KEY,
        camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
        type      TEXT NOT NULL,
        source    TEXT NOT NULL DEFAULT 'onvif',
        ts        TIMESTAMPTZ NOT NULL,
        detail    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_camera_events_camera
        ON camera_events(camera_id, ts DESC);
    `);

    // Preserve v1 enrollments. The v1 row held one encrypted endpoint that
    // could embed credentials; split it into a sanitised URL plus separately
    // encrypted username/password, which is what the v2 model expects.
    const assets = await db.all<LegacyAsset>("SELECT * FROM cctv_assets");
    for (const asset of assets) {
      let endpoint = "";
      try {
        endpoint = decryptSecret(asset.endpoint_enc);
      } catch {
        endpoint = ""; // secret rotated: keep the registration, flag it for re-entry
      }

      let username = asset.username;
      let password: string | null = null;
      let sanitized = endpoint;
      try {
        const url = new URL(endpoint);
        if (url.username) {
          username = decodeURIComponent(url.username);
          password = decodeURIComponent(url.password);
          url.username = "";
          url.password = "";
          sanitized = url.toString();
        }
      } catch {
        /* keep the raw value; validation happens when the operator saves it */
      }

      await db.run(
        `INSERT INTO cameras
           (id, name, rtsp_url, onvif_host, username_enc, password_enc, status,
            created_by, snapshot_interval_s, last_snapshot_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 300, ?, ?, ?)`,
        asset.id,
        asset.name,
        sanitized,
        username ? encryptSecret(username) : null,
        password ? encryptSecret(password) : null,
        sanitized ? (asset.status === "online" ? "unknown" : asset.status) : "needs_config",
        asset.user_id,
        asset.last_checked_at,
        asset.created_at,
        nowIso(),
      );
    }

    await db.exec("DROP TABLE IF EXISTS cctv_assets;");
  },

  async down(db) {
    await db.exec(`
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
    `);

    const rows = await db.all<{
      id: string;
      name: string;
      rtsp_url: string;
      username_enc: string | null;
      password_enc: string | null;
      status: string;
      created_by: string | null;
      last_snapshot_at: string | null;
      created_at: string;
    }>("SELECT * FROM cameras");

    for (const row of rows) {
      if (!row.created_by) continue; // no owner column to put it back into
      let endpoint = row.rtsp_url;
      let username: string | null = null;
      try {
        username = row.username_enc ? decryptSecret(row.username_enc) : null;
        const password = row.password_enc ? decryptSecret(row.password_enc) : "";
        if (username) {
          const url = new URL(row.rtsp_url);
          url.username = encodeURIComponent(username);
          url.password = encodeURIComponent(password);
          endpoint = url.toString();
        }
      } catch {
        /* store the URL without credentials rather than failing the rollback */
      }

      await db.run(
        `INSERT INTO cctv_assets
           (id, user_id, name, protocol, endpoint_enc, username, status, last_checked_at, created_at)
         VALUES (?, ?, ?, 'rtsp', ?, ?, ?, ?, ?)`,
        row.id,
        row.created_by,
        row.name,
        encryptSecret(endpoint),
        username,
        row.status,
        row.last_snapshot_at,
        row.created_at,
      );
    }

    await db.exec(`
      DROP TABLE IF EXISTS camera_events;
      DROP TABLE IF EXISTS camera_snapshots;
      DROP TABLE IF EXISTS cameras;
    `);
  },
};

/* ───────────────────────── 003 · consent geofencing ──────────────────────── */

interface LegacyDevice {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  consent_ref: string;
  active: number;
  created_at: string;
  last_seen_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_accuracy: number | null;
  last_battery: number | null;
}

interface LegacyPing {
  id: string;
  device_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  battery: number | null;
  at: string;
}

const tracking: Migration = {
  id: "003_consent_geofencing",
  dataLoss:
    "Org-wide geofences (device_id IS NULL) cannot be represented in v1 and are dropped on rollback; per-device fences are preserved.",
  async up(db) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS tracked_devices (
        id                 TEXT PRIMARY KEY,
        owner_user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name               TEXT NOT NULL,
        consent_token_hash TEXT NOT NULL UNIQUE,
        consent_ts         TIMESTAMPTZ NOT NULL,
        consent_ref        TEXT,
        created_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
        revoked_at         TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL,
        last_seen_at       TIMESTAMPTZ,
        last_lat           DOUBLE PRECISION,
        last_lon           DOUBLE PRECISION,
        last_accuracy      DOUBLE PRECISION,
        last_battery       DOUBLE PRECISION
      );
      CREATE INDEX IF NOT EXISTS idx_tracked_devices_owner ON tracked_devices(owner_user_id);

      CREATE TABLE IF NOT EXISTS device_locations (
        id        TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES tracked_devices(id) ON DELETE CASCADE,
        lat       DOUBLE PRECISION NOT NULL,
        lon       DOUBLE PRECISION NOT NULL,
        ts        TIMESTAMPTZ NOT NULL,
        accuracy  DOUBLE PRECISION,
        battery   DOUBLE PRECISION
      );
      CREATE INDEX IF NOT EXISTS idx_device_locations_device
        ON device_locations(device_id, ts DESC);
    `);

    const devices = await db.all<LegacyDevice>("SELECT * FROM devices");
    for (const d of devices) {
      await db.run(
        `INSERT INTO tracked_devices
           (id, owner_user_id, name, consent_token_hash, consent_ts, consent_ref, created_by,
            revoked_at, created_at, last_seen_at, last_lat, last_lon, last_accuracy, last_battery)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        d.id,
        d.user_id,
        d.name,
        d.token_hash,
        d.created_at,
        d.consent_ref,
        d.user_id,
        d.active ? null : d.created_at,
        d.created_at,
        d.last_seen_at,
        d.last_lat,
        d.last_lng,
        d.last_accuracy,
        d.last_battery,
      );
    }

    const pings = await db.all<LegacyPing>("SELECT * FROM device_pings");
    for (const p of pings) {
      await db.run(
        "INSERT INTO device_locations (id, device_id, lat, lon, ts, accuracy, battery) VALUES (?, ?, ?, ?, ?, ?, ?)",
        p.id,
        p.device_id,
        p.lat,
        p.lng,
        p.at,
        p.accuracy,
        p.battery,
      );
    }

    // Geofences gain a nullable device scope (NULL = applies to every device),
    // `lon` instead of `lng`, and `created_by` instead of `user_id`. The old
    // column was NOT NULL, which PostgreSQL cannot relax in place.
    await db.exec(`
      CREATE TABLE geofences_v2 (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        lat        DOUBLE PRECISION NOT NULL,
        lon        DOUBLE PRECISION NOT NULL,
        radius_m   INTEGER NOT NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        device_id  TEXT REFERENCES tracked_devices(id) ON DELETE CASCADE,
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL
      );
      INSERT INTO geofences_v2 (id, name, lat, lon, radius_m, created_by, device_id, active, created_at)
        SELECT id, name, lat, lng, radius_m, user_id, device_id, active, created_at FROM geofences;
      DROP TABLE geofences;
      ALTER TABLE geofences_v2 RENAME TO geofences;
      CREATE INDEX IF NOT EXISTS idx_geofences_creator ON geofences(created_by);
      CREATE INDEX IF NOT EXISTS idx_geofences_device ON geofences(device_id);

      CREATE TABLE IF NOT EXISTS geofence_events (
        id          TEXT PRIMARY KEY,
        device_id   TEXT NOT NULL REFERENCES tracked_devices(id) ON DELETE CASCADE,
        geofence_id TEXT NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
        type        TEXT NOT NULL CHECK (type IN ('enter', 'exit')),
        ts          TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_geofence_events_device
        ON geofence_events(device_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_geofence_events_fence
        ON geofence_events(geofence_id, ts DESC);
    `);

    await db.exec(`
      DROP TABLE IF EXISTS device_pings;
      DROP TABLE IF EXISTS devices;
    `);
  },

  async down(db) {
    await db.exec(`
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
    `);

    const devices = await db.all<{
      id: string;
      owner_user_id: string;
      name: string;
      consent_token_hash: string;
      consent_ref: string | null;
      revoked_at: string | null;
      created_at: string;
      last_seen_at: string | null;
      last_lat: number | null;
      last_lon: number | null;
      last_accuracy: number | null;
      last_battery: number | null;
    }>("SELECT * FROM tracked_devices");

    for (const d of devices) {
      await db.run(
        `INSERT INTO devices
           (id, user_id, name, token_hash, consent_ref, active, created_at, last_seen_at, last_lat, last_lng, last_accuracy, last_battery)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        d.id,
        d.owner_user_id,
        d.name,
        d.consent_token_hash,
        d.consent_ref ?? "migrated",
        d.revoked_at ? 0 : 1,
        d.created_at,
        d.last_seen_at,
        d.last_lat,
        d.last_lon,
        d.last_accuracy,
        d.last_battery,
      );
    }

    const locations = await db.all<{
      id: string;
      device_id: string;
      lat: number;
      lon: number;
      ts: string;
      accuracy: number | null;
      battery: number | null;
    }>("SELECT * FROM device_locations");
    for (const l of locations) {
      await db.run(
        "INSERT INTO device_pings (id, device_id, lat, lng, accuracy, battery, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        l.id,
        l.device_id,
        l.lat,
        l.lon,
        l.accuracy,
        l.battery,
        l.ts,
      );
    }

    await db.exec(`
      CREATE TABLE geofences_v1 (
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
      INSERT INTO geofences_v1 (id, user_id, device_id, name, lat, lng, radius_m, active, created_at)
        SELECT id, COALESCE(created_by, (SELECT id FROM users ORDER BY created_at LIMIT 1)),
               device_id, name, lat, lon, radius_m, active, created_at
        FROM geofences WHERE device_id IS NOT NULL;
    `);

    await db.exec(`
      DROP TABLE IF EXISTS geofence_events;
      DROP TABLE geofences;
      ALTER TABLE geofences_v1 RENAME TO geofences;
      DROP TABLE IF EXISTS device_locations;
      DROP TABLE IF EXISTS tracked_devices;
    `);
  },
};

/* ───────────────────────── 004 · Phone-X parity auth ───────────────────────── */

const phonexAuth: Migration = {
  id: "004_phonex_parity_auth",
  dataLoss:
    "OTP codes and top-up records are dropped on rollback; phone-based accounts keep their synthesized email address.",
  async up(db) {
    await db.exec(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS requires_password INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS beta_user INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_id TEXT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_type TEXT;
    `);

    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;

      CREATE TABLE IF NOT EXISTS otp_codes (
        id          TEXT PRIMARY KEY,
        phone       TEXT NOT NULL,
        code_hash   TEXT NOT NULL,
        channel     TEXT NOT NULL DEFAULT 'whatsapp',
        purpose     TEXT NOT NULL DEFAULT 'login',
        attempts    INTEGER NOT NULL DEFAULT 0,
        consumed_at TIMESTAMPTZ,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL,
        ip          TEXT,
        user_agent  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, created_at DESC);

      CREATE TABLE IF NOT EXISTS topups (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider      TEXT NOT NULL,
        tokens        INTEGER NOT NULL,
        amount_idr    INTEGER,
        amount_usd    NUMERIC(12, 2),
        status        TEXT NOT NULL DEFAULT 'pending',
        reference     TEXT NOT NULL UNIQUE,
        qr_payload    TEXT,
        pay_address   TEXT,
        created_at    TIMESTAMPTZ NOT NULL,
        expires_at    TIMESTAMPTZ,
        paid_at       TIMESTAMPTZ,
        settled_by    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_topups_user ON topups(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_topups_status ON topups(status);
    `);
  },

  async down(db) {
    await db.exec(`
      DROP TABLE IF EXISTS topups;
      DROP TABLE IF EXISTS otp_codes;
      DROP INDEX IF EXISTS idx_users_phone;
      ALTER TABLE sessions DROP COLUMN IF EXISTS device_type;
      ALTER TABLE sessions DROP COLUMN IF EXISTS device_id;
      ALTER TABLE users DROP COLUMN IF EXISTS beta_user;
      ALTER TABLE users DROP COLUMN IF EXISTS requires_password;
      ALTER TABLE users DROP COLUMN IF EXISTS phone_verified_at;
      ALTER TABLE users DROP COLUMN IF EXISTS gmail;
      ALTER TABLE users DROP COLUMN IF EXISTS whatsapp;
      ALTER TABLE users DROP COLUMN IF EXISTS phone;
    `);
  },
};

/* ─────────────────────────── 005 · geofence chains ─────────────────────────── */

const geofenceChains: Migration = {
  id: "005_geofence_chains",
  dataLoss: "Shareable geofence chains and the reports submitted through them are dropped on rollback.",
  async up(db) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS geofence_chains (
        id         TEXT PRIMARY KEY,
        code       TEXT NOT NULL UNIQUE,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label      TEXT NOT NULL,
        active     INTEGER NOT NULL DEFAULT 1,
        views      INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_geofence_chains_user ON geofence_chains(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS geofence_reports (
        id         TEXT PRIMARY KEY,
        chain_id   TEXT NOT NULL REFERENCES geofence_chains(id) ON DELETE CASCADE,
        lat        DOUBLE PRECISION NOT NULL,
        lng        DOUBLE PRECISION NOT NULL,
        accuracy   DOUBLE PRECISION,
        note       TEXT,
        ip         TEXT,
        user_agent TEXT,
        at         TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_geofence_reports_chain ON geofence_reports(chain_id, at DESC);
    `);
  },

  async down(db) {
    await db.exec(`
      DROP TABLE IF EXISTS geofence_reports;
      DROP TABLE IF EXISTS geofence_chains;
    `);
  },
};

export const MIGRATIONS: Migration[] = [
  notifications,
  cameras,
  tracking,
  phonexAuth,
  geofenceChains,
];

export interface MigrationStatus {
  id: string;
  applied: boolean;
  appliedAt: string | null;
}

async function appliedRows(db: Db): Promise<Map<string, string>> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id         TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL
  );`);
  const rows = await db.all<{ id: string; applied_at: string }>(
    "SELECT id, applied_at FROM schema_migrations",
  );
  return new Map(rows.map((row) => [row.id, row.applied_at]));
}

/** Applies every pending migration. The `db` must be bound to one client. */
export async function applyMigrations(db: Db): Promise<string[]> {
  const applied = await appliedRows(db);
  const ran: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;

    await db.exec("BEGIN");
    try {
      await migration.up(db);
      await db.run(
        "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        migration.id,
        nowIso(),
      );
      await db.exec("COMMIT");
      ran.push(migration.id);
    } catch (err) {
      await db.exec("ROLLBACK");
      throw new Error(`Migration ${migration.id} failed: ${(err as Error).message}`);
    }
  }

  return ran;
}

export async function migrationStatus(db: Db): Promise<MigrationStatus[]> {
  const applied = await appliedRows(db);
  return MIGRATIONS.map((migration) => ({
    id: migration.id,
    applied: applied.has(migration.id),
    appliedAt: applied.get(migration.id) ?? null,
  }));
}

/** Rolls back the most recently applied migration. Returns its id, or null. */
export async function rollbackLast(db: Db): Promise<string | null> {
  const applied = await appliedRows(db);
  const last = [...MIGRATIONS].reverse().find((migration) => applied.has(migration.id));
  if (!last) return null;

  await db.exec("BEGIN");
  try {
    await last.down(db);
    await db.run("DELETE FROM schema_migrations WHERE id = ?", last.id);
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw new Error(`Rollback of ${last.id} failed: ${(err as Error).message}`);
  }

  return last.id;
}
