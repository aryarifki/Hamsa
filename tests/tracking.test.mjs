import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://hamsa:hamsa@127.0.0.1:5432/hamsa_test";
process.env.HAMSA_SECRET = "tracking-test-secret-not-used-anywhere-else";

const db = await import("../lib/db.ts");
const crypto = await import("../lib/crypto.ts");
const users = await import("../lib/users.ts");
const consent = await import("../lib/track/consent.ts");
const geofence = await import("../lib/track/geofence.ts");
const { POST } = await import("../app/api/v1/device/ping/route.ts");

const INSIDE = { lat: -6.2001, lon: 106.8001 };
const OUTSIDE = { lat: -6.21, lon: 106.81 };

let admin;
let owner;
let colleague;

const post = (token, body = INSIDE) =>
  POST(
    new Request("http://localhost/api/v1/device/ping", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

before(async () => {
  await db.ensureSchema();
  await db.resetDatabase();

  admin = await users.createUser({
    email: "admin@track.test",
    name: "Admin",
    passwordHash: crypto.hashPassword("a-long-test-password"),
    role: "admin",
  });
  owner = await users.createUser({
    email: "owner@track.test",
    name: "Owner",
    passwordHash: crypto.hashPassword("a-long-test-password"),
    role: "analyst",
  });
  colleague = await users.createUser({
    email: "colleague@track.test",
    name: "Colleague",
    passwordHash: crypto.hashPassword("a-long-test-password"),
    role: "analyst",
  });
});

after(async () => {
  await db.closePool();
});

test("registration mints a one-time token and stores only its digest", async () => {
  const { device, token } = await consent.registerDevice({
    ownerUserId: owner.id,
    name: "Field kit",
    consentRef: "CONSENT-2026-001",
    actor: owner,
  });

  assert.match(token, /^[0-9a-f-]{36}$/);
  assert.notEqual(device.consent_token_hash, token);
  assert.equal(device.consent_token_hash, crypto.sha256(token));
  assert.equal(device.consent_token_hash.length, 64);
  assert.equal(device.owner_user_id, owner.id);
  assert.equal(device.revoked_at, null);

  const stored = await db.one("SELECT * FROM tracked_devices WHERE id = ?", device.id);
  assert.equal(JSON.stringify(stored).includes(token), false, "plaintext token must not be stored");

  const audits = await db.all(
    "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY action",
    device.id,
  );
  assert.deepEqual(
    audits.map((row) => row.action),
    ["device.consent", "device.create"],
  );

  assert.ok(await consent.findDeviceByToken(token));
  assert.equal(await consent.findDeviceByToken("not-a-token"), undefined);
});

test("ownership decides who can revoke a device", async () => {
  const { device } = await consent.registerDevice({
    ownerUserId: owner.id,
    name: "Owner kit",
    consentRef: "CONSENT-2026-002",
    actor: owner,
  });

  await assert.rejects(() => consent.revokeDevice(device.id, colleague), /Device not found/);
  assert.equal(await consent.revokeDevice(device.id, owner), true);
  assert.equal(await consent.revokeDevice(device.id, owner), false, "second revoke is a no-op");

  const row = await db.one("SELECT revoked_at FROM tracked_devices WHERE id = ?", device.id);
  assert.ok(row.revoked_at);

  const audit = await db.one(
    "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'device.revoke' AND entity_id = ?",
    device.id,
  );
  assert.equal(audit.n, 1);
});

test("a device records enter and exit exactly once per transition", async () => {
  const { device, token } = await consent.registerDevice({
    ownerUserId: owner.id,
    name: "Patrol kit",
    consentRef: "CONSENT-2026-003",
    actor: owner,
  });

  const fence = await geofence.createGeofence({
    user: owner,
    name: "Warehouse",
    lat: -6.2,
    lon: 106.8,
    radiusM: 200,
    deviceId: device.id,
  });

  const first = await geofence.recordLocation(token, OUTSIDE);
  assert.equal(first.transitions.length, 0);
  assert.equal(first.fences.length, 1);
  assert.equal(first.fences[0].inside, false);

  const entering = await geofence.recordLocation(token, INSIDE);
  assert.deepEqual(entering.transitions.map((t) => t.type), ["enter"]);
  assert.equal(entering.fences[0].inside, true);

  const stillInside = await geofence.recordLocation(token, { lat: -6.2002, lon: 106.8002 });
  assert.equal(stillInside.transitions.length, 0, "an enter must not repeat while inside");

  const leaving = await geofence.recordLocation(token, OUTSIDE);
  assert.deepEqual(leaving.transitions.map((t) => t.type), ["exit"]);

  const stillOutside = await geofence.recordLocation(token, OUTSIDE);
  assert.equal(stillOutside.transitions.length, 0, "an exit must not repeat while outside");

  const events = await db.all(
    "SELECT type FROM geofence_events WHERE device_id = ? ORDER BY ts",
    device.id,
  );
  assert.deepEqual(events.map((event) => event.type), ["enter", "exit"]);

  const notes = await db.all(
    "SELECT kind, title FROM notifications WHERE user_id = ? ORDER BY created_at",
    owner.id,
  );
  assert.deepEqual(notes.map((note) => note.kind), ["geofence.enter", "geofence.exit"]);
  assert.match(notes[0].title, /entered Warehouse/);

  const audits = await db.all(
    "SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'geofence.%' ORDER BY action",
    fence.id,
  );
  assert.deepEqual(
    audits.map((row) => row.action),
    ["geofence.create", "geofence.enter", "geofence.exit"],
  );

  const latest = await db.one("SELECT last_lat, last_lon FROM tracked_devices WHERE id = ?", device.id);
  assert.equal(latest.last_lat, OUTSIDE.lat);
  assert.equal(latest.last_lon, OUTSIDE.lon);
});

test("an organisation-wide fence applies to every device", async () => {
  const { device, token } = await consent.registerDevice({
    ownerUserId: owner.id,
    name: "Second kit",
    consentRef: "CONSENT-2026-004",
    actor: owner,
  });

  await geofence.createGeofence({
    user: admin,
    name: "Head office",
    lat: -6.3,
    lon: 106.9,
    radiusM: 500,
    deviceId: null,
  });

  const result = await geofence.recordLocation(token, { lat: -6.3, lon: 106.9 });
  assert.equal(result.fences.length >= 1, true);
  assert.ok(result.fences.some((fence) => fence.name === "Head office" && fence.inside));
  assert.ok(result.transitions.some((transition) => transition.type === "enter"));
});

test("analysts cannot create organisation-wide fences", async () => {
  await assert.rejects(
    () => geofence.createGeofence({
      user: owner,
      name: "Private attempt",
      lat: -6.3,
      lon: 106.9,
      radiusM: 500,
      deviceId: null,
    }),
    /Only administrators/,
  );
});

test("the HTTP endpoint rejects every unusable token with the same 403", async () => {
  const missing = await post("");
  assert.equal(missing.status, 403);
  assert.deepEqual(await missing.json(), { error: "Forbidden" });

  const forged = await post("00000000-0000-4000-8000-000000000000");
  assert.equal(forged.status, 403);

  const { device, token } = await consent.registerDevice({
    ownerUserId: owner.id,
    name: "Revoked kit",
    consentRef: "CONSENT-2026-005",
    actor: owner,
  });
  await consent.revokeDevice(device.id, owner);

  const revoked = await post(token);
  assert.equal(revoked.status, 403);
  assert.deepEqual(await revoked.json(), { error: "Forbidden" });
});

test("the endpoint accepts a valid token and reports fence state", async () => {
  const { device, token } = await consent.registerDevice({
    ownerUserId: owner.id,
    name: "API kit",
    consentRef: "CONSENT-2026-006",
    actor: owner,
  });

  const response = await post(token, INSIDE);
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.device.id, device.id);
  assert.ok(body.receivedAt);
  assert.ok(Array.isArray(body.fences));
  assert.ok(body.fences.some((fence) => fence.name === "Head office"));
  assert.ok(Array.isArray(body.transitions));
  assert.ok(body.fences.every((fence) => typeof fence.distanceMeters === "number"));
});

test("each token is limited to 60 updates per minute", async () => {
  const { token } = await consent.registerDevice({
    ownerUserId: owner.id,
    name: "Chatty kit",
    consentRef: "CONSENT-2026-007",
    actor: owner,
  });

  for (let i = 0; i < 60; i += 1) {
    const response = await post(token, { lat: -6.2001, lon: 106.8001 });
    assert.equal(response.status, 200, `request ${i + 1} should be accepted`);
  }

  const blocked = await post(token, { lat: -6.2001, lon: 106.8001 });
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.ok(body.retryAfter >= 1);
});
