import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

process.env.HAMSA_SECRET = "migration-test-secret-not-used-anywhere-else";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://hamsa:hamsa@127.0.0.1:5432/hamsa_test";

const { SCHEMA } = await import("../lib/schema.ts");
const { clientDb } = await import("../lib/db.ts");
const { applyMigrations, migrationStatus, rollbackLast } = await import("../lib/migrations.ts");
const { encryptSecret, decryptSecret } = await import("../lib/crypto.ts");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const schema = `hamsa_mig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const client = await pool.connect();
await client.query(`CREATE SCHEMA "${schema}"`);
await client.query(`SET search_path TO "${schema}"`);
const db = clientDb(client);

after(async () => {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
  client.release();
  await pool.end();
});

const count = async (table) => {
  const row = await db.one(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return row.n;
};

const tableExists = async (table) =>
  (await db.one("SELECT to_regclass(?) AS oid", table))?.oid !== null;

async function seedV1() {
  await db.exec(SCHEMA);

  await db.run(
    "INSERT INTO users (id, email, name, password_hash, role, credits, created_at) VALUES (?, ?, ?, ?, 'analyst', 0, ?)",
    "u1",
    "a@example.test",
    "Analyst",
    "scrypt$x",
    "2026-01-01T00:00:00.000Z",
  );

  await db.run(
    `INSERT INTO devices (id, user_id, name, token_hash, consent_ref, active, created_at, last_seen_at, last_lat, last_lng, last_accuracy, last_battery)
     VALUES (?, 'u1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "d1",
    "Field kit",
    "hash-1",
    "CONSENT-1",
    1,
    "2026-01-02T00:00:00.000Z",
    "2026-01-03T00:00:00.000Z",
    -6.2,
    106.8,
    12,
    80,
  );
  await db.run(
    `INSERT INTO devices (id, user_id, name, token_hash, consent_ref, active, created_at, last_seen_at, last_lat, last_lng, last_accuracy, last_battery)
     VALUES (?, 'u1', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
    "d2",
    "Retired kit",
    "hash-2",
    "CONSENT-2",
    0,
    "2026-01-04T00:00:00.000Z",
  );

  for (const [id, lat, lng, at] of [
    ["p1", -6.2, 106.8, "2026-01-03T00:00:00.000Z"],
    ["p2", -6.21, 106.81, "2026-01-03T00:05:00.000Z"],
    ["p3", -6.22, 106.82, "2026-01-03T00:10:00.000Z"],
  ]) {
    await db.run(
      "INSERT INTO device_pings (id, device_id, lat, lng, accuracy, battery, at) VALUES (?, 'd1', ?, ?, 10, 81, ?)",
      id,
      lat,
      lng,
      at,
    );
  }

  await db.run(
    "INSERT INTO geofences (id, user_id, device_id, name, lat, lng, radius_m, active, created_at) VALUES (?, 'u1', ?, ?, ?, ?, ?, 1, ?)",
    "g1",
    "d1",
    "HQ",
    -6.2,
    106.8,
    500,
    "2026-01-02T00:00:00.000Z",
  );

  await db.run(
    `INSERT INTO cctv_assets (id, user_id, name, protocol, endpoint_enc, username, status, last_checked_at, created_at)
     VALUES (?, 'u1', ?, 'rtsp', ?, NULL, 'online', ?, ?)`,
    "c1",
    "Gate",
    encryptSecret("rtsp://operator:s3cret@10.0.0.9:554/Streaming/Channels/101"),
    "2026-01-05T00:00:00.000Z",
    "2026-01-05T00:00:00.000Z",
  );
}

test("v1 database upgrades without losing devices, pings, fences or cameras", async () => {
  await seedV1();

  const applied = await applyMigrations(db);
  assert.deepEqual(applied, ["001_notifications", "002_camera_monitor", "003_consent_geofencing"]);

  assert.equal(await count("tracked_devices"), 2);
  assert.equal(await count("device_locations"), 3);
  assert.equal(await count("geofences"), 1);
  assert.equal(await count("cameras"), 1);

  const tracked = await db.one("SELECT * FROM tracked_devices WHERE id = 'd1'");
  assert.equal(tracked.owner_user_id, "u1");
  assert.equal(tracked.consent_token_hash, "hash-1");
  assert.equal(tracked.consent_ts, "2026-01-02T00:00:00.000Z");
  assert.equal(tracked.revoked_at, null);
  assert.equal(tracked.last_lon, 106.8);

  const retired = await db.one("SELECT * FROM tracked_devices WHERE id = 'd2'");
  assert.ok(retired.revoked_at, "inactive v1 device must map to a revoked consent");

  const fence = await db.one("SELECT * FROM geofences WHERE id = 'g1'");
  assert.equal(fence.lon, 106.8);
  assert.equal(fence.created_by, "u1");
  assert.equal(fence.device_id, "d1");

  const camera = await db.one("SELECT * FROM cameras WHERE id = 'c1'");
  assert.equal(camera.rtsp_url, "rtsp://10.0.0.9:554/Streaming/Channels/101");
  assert.equal(camera.username_enc.startsWith("v1."), true);
  assert.equal(decryptSecret(camera.username_enc), "operator");
  assert.equal(decryptSecret(camera.password_enc), "s3cret");
  assert.equal(camera.created_by, "u1");

  // Re-running is a no-op.
  assert.deepEqual(await applyMigrations(db), []);
});

test("down migrations restore the v1 structure and rows", async () => {
  assert.equal(await rollbackLast(db), "003_consent_geofencing");
  assert.equal(await count("devices"), 2);
  assert.equal(await count("device_pings"), 3);
  assert.equal(await count("geofences"), 1);
  assert.equal(await tableExists("tracked_devices"), false);
  assert.equal((await db.one("SELECT lng FROM geofences WHERE id = 'g1'")).lng, 106.8);

  let status = await migrationStatus(db);
  assert.equal(status.find((s) => s.id === "003_consent_geofencing").applied, false);
  assert.equal(status.find((s) => s.id === "002_camera_monitor").applied, true);

  assert.equal(await rollbackLast(db), "002_camera_monitor");
  assert.equal(await count("cctv_assets"), 1);
  assert.equal(await tableExists("cameras"), false);
  const asset = await db.one("SELECT endpoint_enc FROM cctv_assets WHERE id = 'c1'");
  assert.match(decryptSecret(asset.endpoint_enc), /operator:s3cret@10\.0\.0\.9/);

  assert.equal(await rollbackLast(db), "001_notifications");
  assert.equal(await tableExists("notifications"), false);
  assert.equal(await rollbackLast(db), null);
});

test("up again after a full rollback recreates and re-copies everything", async () => {
  const applied = await applyMigrations(db);
  assert.deepEqual(applied, ["001_notifications", "002_camera_monitor", "003_consent_geofencing"]);

  assert.equal(await count("tracked_devices"), 2);
  assert.equal(await count("device_locations"), 3);
  assert.equal(await count("geofences"), 1);
  assert.equal(await count("cameras"), 1);

  const camera = await db.one("SELECT * FROM cameras WHERE id = 'c1'");
  assert.equal(decryptSecret(camera.username_enc), "operator");
  assert.equal(decryptSecret(camera.password_enc), "s3cret");
});
