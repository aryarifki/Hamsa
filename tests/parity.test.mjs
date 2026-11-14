import test, { after, before } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://hamsa:hamsa@127.0.0.1:5432/hamsa_test";
process.env.HAMSA_SECRET = "parity-test-secret-not-used-anywhere-else";
process.env.OTP_DEV_MODE = "true";
delete process.env.OTP_WEBHOOK_URL;

const db = await import("../lib/db.ts");
const crypto = await import("../lib/crypto.ts");
const users = await import("../lib/users.ts");
const authPhonex = await import("../lib/auth-phonex.ts");
const http = await import("../lib/http.ts");
const billing = await import("../lib/tokens-phonex.ts");
const chainLib = await import("../lib/track/chain.ts");
const preview = await import("../lib/track/geofence-preview.ts");

let owner;
let colleague;

before(async () => {
  await db.ensureSchema();
  await db.resetDatabase();

  owner = await users.createUser({
    email: "owner@parity.test",
    name: "Owner",
    passwordHash: crypto.hashPassword("a-long-test-password"),
    role: "analyst",
    credits: 0,
  });
  colleague = await users.createUser({
    email: "colleague@parity.test",
    name: "Colleague",
    passwordHash: crypto.hashPassword("a-long-test-password"),
    role: "analyst",
  });
});

after(async () => {
  await db.closePool();
});

/* ── OTP auth ───────────────────────────────────────────────────────── */

test("request-otp returns a dev code and verify-otp creates the account once", async () => {
  const requested = await authPhonex.requestOtp({ phone: "0812-3456-7890", ip: "127.0.0.1" });
  assert.equal(requested.phone, "+6281234567890");
  assert.equal(typeof requested.devCode, "string");
  assert.match(requested.devCode, /^\d{6}$/);

  const session = await authPhonex.verifyOtp({ phone: "081234567890", code: requested.devCode });
  assert.match(session.sessionToken, /^[A-Za-z0-9_-]{20,}$/);
  assert.equal(session.phoneNumber, "+6281234567890");
  assert.equal(session.requiresPassword, false);

  const row = await db.one("SELECT * FROM users WHERE phone = ?", "+6281234567890");
  assert.ok(row, "the account is created on first successful verification");
  assert.equal(row.email, "+6281234567890".replace(/\D/g, "") + "@otp.hamsa.local");
  assert.equal(row.password_hash, "");
  assert.ok(row.phone_verified_at);

  // The same code cannot be replayed.
  await assert.rejects(
    () => authPhonex.verifyOtp({ phone: "081234567890", code: requested.devCode }),
    (err) => err.code === "OTP_MISSING" || err.code === "OTP_INVALID",
  );
});

test("a second verification reuses the same account instead of duplicating it", async () => {
  const first = await authPhonex.requestOtp({ phone: "+628111111111" });
  await authPhonex.verifyOtp({ phone: "+628111111111", code: first.devCode });

  const second = await authPhonex.requestOtp({ phone: "+628111111111" });
  const verified = await authPhonex.verifyOtp({ phone: "+628111111111", code: second.devCode });

  const rows = await db.all("SELECT id FROM users WHERE phone = ?", "+628111111111");
  assert.equal(rows.length, 1);
  assert.equal(verified.user.id, rows[0].id);
});

test("a wrong code burns an attempt and five wrong codes lock the number", async () => {
  const requested = await authPhonex.requestOtp({ phone: "+628122222222" });

  await assert.rejects(
    () => authPhonex.verifyOtp({ phone: "+628122222222", code: "000000" === requested.devCode ? "111111" : "000000" }),
    (err) => err.code === "OTP_INVALID" && typeof err.extra?.attemptsLeft === "number",
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      () => authPhonex.verifyOtp({ phone: "+628122222222", code: "999999" === requested.devCode ? "888888" : "999999" }),
      (err) => err.code === "OTP_INVALID",
    );
  }

  await assert.rejects(
    () => authPhonex.verifyOtp({ phone: "+628122222222", code: requested.devCode }),
    (err) => err.code === "OTP_LOCKED",
  );
});

test("a session token from verify-otp authenticates an API request", async () => {
  const requested = await authPhonex.requestOtp({ phone: "+628133333333" });
  const session = await authPhonex.verifyOtp({ phone: "+628133333333", code: requested.devCode });

  const req = new Request("http://localhost/api/v1/auth/web/me", {
    headers: { "x-session-token": session.sessionToken },
  });
  const ctx = await http.authenticate(req);
  assert.ok(ctx, "x-session-token must resolve to a user");
  assert.equal(ctx.user.id, session.user.id);
  assert.equal(ctx.via, "session");

  assert.equal(await authPhonex.revokeSessionToken(session.sessionToken), true);
  assert.equal(await http.authenticate(req), null);
});

test("password login is rejected for an OTP-only account", async () => {
  await assert.rejects(
    () => authPhonex.loginWithPassword({ identifier: "+6281234567890", password: "anything-at-all" }),
    (err) => err.code === "INVALID_CREDENTIALS",
  );

  await authPhonex.setPassword((await db.one("SELECT id FROM users WHERE phone = ?", "+6281234567890")).id, "a-very-long-password");
  const result = await authPhonex.loginWithPassword({
    identifier: "+6281234567890",
    password: "a-very-long-password",
  });
  assert.ok(result.sessionToken);
});

/* ── top-ups ────────────────────────────────────────────────────────── */

test("settling a top-up credits once, and a retry reports alreadySettled", async () => {
  const { topup } = await billing.createTopup(owner.id, "qris-10");

  const first = await billing.settleTopup(topup.reference, { settledBy: "admin:test" });
  assert.equal(first.alreadySettled, false);
  assert.equal(first.balance, 10);
  assert.equal(first.topup.status, "paid");

  const retry = await billing.settleTopup(topup.reference, { settledBy: "webhook" });
  assert.equal(retry.alreadySettled, true);
  assert.equal(retry.balance, 10, "a retried settlement must never credit twice");

  const ledger = await db.all("SELECT * FROM ledger WHERE user_id = ? AND ref_type = 'topup'", owner.id);
  assert.equal(ledger.length, 1);
});

test("an expired top-up refuses settlement", async () => {
  const { topup } = await billing.createTopup(owner.id, "usdt-50");
  await db.run("UPDATE topups SET expires_at = ? WHERE id = ?", "2020-01-01T00:00:00.000Z", topup.id);

  await assert.rejects(
    () => billing.settleTopup(topup.reference, { settledBy: "admin:test" }),
    (err) => err.code === "TOPUP_EXPIRED",
  );

  const row = await db.one("SELECT status FROM topups WHERE id = ?", topup.id);
  assert.equal(row.status, "expired");
});

test("plans cover the six QRIS and four USDT packs with the documented prices", () => {
  const qris = billing.PLANS.filter((plan) => plan.provider === "qris");
  const usdt = billing.PLANS.filter((plan) => plan.provider === "usdt");

  assert.deepEqual(qris.map((plan) => plan.tokens), [10, 20, 50, 100, 200, 300]);
  assert.deepEqual(qris.map((plan) => plan.amountIdr), [40_000, 80_000, 200_000, 400_000, 800_000, 1_200_000]);
  assert.deepEqual(usdt.map((plan) => plan.tokens), [50, 100, 200, 300]);
  assert.deepEqual(usdt.map((plan) => plan.amountUsd), [12.5, 25, 50, 75]);
});

test("a top-up without a configured rail still exists and says what is missing", async () => {
  delete process.env.HAMSA_QRIS_MERCHANT_PAYLOAD;
  const { instructions } = await billing.createTopup(owner.id, "qris-20");
  assert.equal(instructions.qrPayload, null);
  assert.equal(instructions.warnings.length, 1);
  assert.match(instructions.warnings[0], /HAMSA_QRIS_MERCHANT_PAYLOAD/);
});

/* ── Tango chains ───────────────────────────────────────────────────── */

test("a chain accepts a public report and only the owner can read it", async () => {
  const chain = await chainLib.createChain(owner, { label: "Operation test", ttlHours: 2 });
  assert.match(chain.code, /^[A-Z2-9]{8}$/);

  const { report } = await chainLib.addReport(chain.code, { lat: -6.2, lng: 106.8, accuracy: 15, note: "here" });
  assert.equal(report.chain_id, chain.id);

  const mine = await chainLib.listReports(chain.id, owner);
  assert.equal(mine.length, 1);

  await assert.rejects(
    () => chainLib.listReports(chain.id, colleague),
    (err) => err.status === 404,
  );
});

test("a revoked chain refuses new reports", async () => {
  const chain = await chainLib.createChain(owner, { label: "Revoke me" });
  await chainLib.revokeChain(chain.id, owner);

  await assert.rejects(
    () => chainLib.addReport(chain.code, { lat: -6.2, lng: 106.8 }),
    (err) => err.status === 410 && err.code === "CHAIN_CLOSED",
  );

  const cleared = await chainLib.deleteReports(chain.id, owner);
  assert.equal(cleared, 0);
});

/* ── EXIF preview ───────────────────────────────────────────────────── */

/** Builds a minimal JPEG whose APP1 block carries GPS lat/lon. */
function jpegWithGps(lat, lon) {
  const abs = (value) => Math.abs(value);
  const dms = (value) => {
    const deg = Math.floor(abs(value));
    const minutesFloat = (abs(value) - deg) * 60;
    const minutes = Math.floor(minutesFloat);
    const seconds = Math.round((minutesFloat - minutes) * 60);
    return [deg, minutes, seconds];
  };

  const latDms = dms(lat);
  const lonDms = dms(lon);

  const gpsIfdOffset = 8 + 2 + 12 + 4; // IFD0 header + one entry + next pointer
  const dataOffset = gpsIfdOffset + 2 + 4 * 12 + 4; // GPS IFD + four entries + next pointer

  const tiff = Buffer.alloc(dataOffset + 48);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 at 8

  tiff.writeUInt16LE(1, 8); // one entry in IFD0
  tiff.writeUInt16LE(0x8825, 10); // GPS IFD pointer
  tiff.writeUInt16LE(4, 12); // LONG
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(gpsIfdOffset, 18);
  tiff.writeUInt32LE(0, 22); // no IFD1

  tiff.writeUInt16LE(4, gpsIfdOffset);
  const entry = (index, tag, type, count, value) => {
    const at = gpsIfdOffset + 2 + index * 12;
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    tiff.writeUInt32LE(value, at + 8);
  };
  entry(0, 0x0001, 2, 2, lat >= 0 ? 0x0000004e : 0x00000053); // "N"/"S"
  entry(1, 0x0002, 5, 3, dataOffset);
  entry(2, 0x0003, 2, 2, lon >= 0 ? 0x00000045 : 0x00000057); // "E"/"W"
  entry(3, 0x0004, 5, 3, dataOffset + 24);
  tiff.writeUInt32LE(0, gpsIfdOffset + 2 + 4 * 12);

  const writeRationals = (start, values) => {
    values.forEach((value, index) => {
      tiff.writeUInt32LE(value, start + index * 8);
      tiff.writeUInt32LE(1, start + index * 8 + 4);
    });
  };
  writeRationals(dataOffset, latDms);
  writeRationals(dataOffset + 24, lonDms);

  const app1Payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1 = Buffer.alloc(4 + app1Payload.length);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(app1Payload.length + 2, 2);
  app1Payload.copy(app1, 4);

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xd9])]);
}

test("EXIF GPS decodes to the coordinates that were written", () => {
  const gps = preview.extractExifGps(jpegWithGps(-6.2, 106.8));
  assert.equal(gps.found, true);
  assert.ok(Math.abs(gps.lat - -6.2) < 0.001, `lat was ${gps.lat}`);
  assert.ok(Math.abs(gps.lon - 106.8) < 0.001, `lon was ${gps.lon}`);
  assert.equal(gps.altitude, null);
});

test("an image without EXIF says so instead of guessing", () => {
  const plain = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const gps = preview.extractExifGps(plain);
  assert.equal(gps.found, false);
  assert.match(gps.warnings.join(" "), /EXIF/);

  const notJpeg = preview.extractExifGps(Buffer.from("GIF89a"));
  assert.equal(notJpeg.found, false);
  assert.match(notJpeg.warnings.join(" "), /JPEG/);
});

test("data URLs and bare base64 both decode", () => {
  const bytes = Buffer.from("hello");
  const bare = preview.decodeImagePayload(bytes.toString("base64"));
  const dataUrl = preview.decodeImagePayload(`data:image/jpeg;base64,${bytes.toString("base64")}`);
  assert.deepEqual([...bare], [...bytes]);
  assert.deepEqual([...dataUrl], [...bytes]);
});
