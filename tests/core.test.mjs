import test from "node:test";
import assert from "node:assert/strict";

process.env.HAMSA_DB_PATH = ":memory:";
process.env.HAMSA_SECRET = "unit-test-secret-do-not-use-anywhere-else";
process.env.HAMSA_COST_PHONE = "2";

const crypto = await import("../lib/crypto.ts");
const geo = await import("../lib/intel/geo.ts");
const phone = await import("../lib/intel/phone.ts");
const ip = await import("../lib/intel/ip.ts");
const db = await import("../lib/db.ts");
const users = await import("../lib/users.ts");
const tokens = await import("../lib/tokens.ts");

/* ── crypto ─────────────────────────────────────────────────────────── */

test("scrypt hashes verify and reject", () => {
  const hash = crypto.hashPassword("correct horse battery staple");
  assert.match(hash, /^scrypt\$/);
  assert.equal(crypto.verifyPassword("correct horse battery staple", hash), true);
  assert.equal(crypto.verifyPassword("wrong password", hash), false);
  assert.equal(crypto.verifyPassword("anything", "garbage"), false);
});

test("hashes are salted (same password, different digest)", () => {
  assert.notEqual(crypto.hashPassword("same"), crypto.hashPassword("same"));
});

test("AES-GCM round-trips and detects tampering", () => {
  const secret = "token=abc123";
  const sealed = crypto.encryptSecret(secret);
  assert.notEqual(sealed, secret);
  assert.equal(sealed.split(".")[0], "v1");
  assert.equal(crypto.decryptSecret(sealed), secret);

  const parts = sealed.split(".");
  const tampered = [parts[0], parts[1], parts[2], Buffer.from("evil").toString("base64")].join(".");
  assert.throws(() => crypto.decryptSecret(tampered));
});

test("safeEqual is length-safe", () => {
  assert.equal(crypto.safeEqual("abc", "abc"), true);
  assert.equal(crypto.safeEqual("abc", "abd"), false);
  assert.equal(crypto.safeEqual("abc", "abcd"), false);
});

/* ── geo ────────────────────────────────────────────────────────────── */

test("haversine matches a known distance", () => {
  // Jakarta (Monas) → Bandung: roughly 118-121 km great-circle.
  const distance = geo.haversineMeters(
    { lat: -6.1754, lng: 106.8272 },
    { lat: -6.9175, lng: 107.6191 },
  );
  assert.ok(distance > 115_000 && distance < 125_000, `unexpected distance ${distance}`);
});

test("geofence containment respects the radius", () => {
  const fence = { lat: -6.2, lng: 106.8, radius_m: 500 };
  assert.equal(geo.insideFence({ lat: -6.2, lng: 106.8 }, fence), true);
  assert.equal(geo.insideFence({ lat: -6.21, lng: 106.81 }, fence), false);
});

test("coordinate validation rejects out-of-range values", () => {
  assert.equal(geo.validLatLng(-6.2, 106.8), true);
  assert.equal(geo.validLatLng(91, 0), false);
  assert.equal(geo.validLatLng(0, 181), false);
  assert.equal(geo.validLatLng(Number.NaN, 0), false);
});

/* ── phone ──────────────────────────────────────────────────────────── */

test("Indonesian numbers normalise to E.164", () => {
  assert.equal(phone.normalizePhone("081234567890", "ID"), "+6281234567890");
  assert.equal(phone.normalizePhone("+62 812-3456-7890", "ID"), "+6281234567890");
  assert.equal(phone.normalizePhone("not a number", "ID"), null);
});

test("phone investigation returns carrier and type without a provider", async () => {
  const result = await phone.investigatePhone("081234567890", "ID");
  const data = result.data;
  assert.equal(data.e164, "+6281234567890");
  assert.equal(data.valid, true);
  assert.equal(data.country, "ID");
  assert.equal(data.type, "MOBILE");
  assert.equal(data.carrier, "Telkomsel");
  assert.equal(data.carrierSource, "offline-prefix");
  assert.ok(result.warnings.some((w) => w.includes("NUMVERIFY_KEY")));
});

test("invalid phone numbers are reported, not thrown", async () => {
  const result = await phone.investigatePhone("12345", "ID");
  assert.equal(result.data.valid, false);
});

/* ── ip ─────────────────────────────────────────────────────────────── */

test("private addresses never leave the box", async () => {
  const result = await ip.investigateIp("192.168.1.10");
  assert.equal(result.data.scope, "private");
  assert.equal(result.data.provider, "none");
});

test("invalid addresses are rejected cleanly", async () => {
  const result = await ip.investigateIp("999.1.1.1");
  assert.equal(result.data.scope, "invalid");
});

test("IPv6 loopback is classified", async () => {
  const result = await ip.investigateIp("::1");
  assert.equal(result.data.scope, "loopback");
});

/* ── users, ledger, billing ─────────────────────────────────────────── */

test("credits are debited atomically and never overdrawn", () => {
  const user = users.createUser({
    email: "analyst@test.local",
    name: "Test Analyst",
    passwordHash: crypto.hashPassword("a-long-test-password"),
    credits: 0,
  });

  assert.equal(tokens.balanceOf(user.id), 0);
  tokens.grant(user.id, 5, "test:grant");
  assert.equal(tokens.balanceOf(user.id), 5);

  assert.equal(tokens.charge(user.id, 2, "lookup:phone"), 3);
  assert.throws(() => tokens.charge(user.id, 99, "lookup:phone"), tokens.InsufficientCreditsError);
  assert.equal(tokens.balanceOf(user.id), 3, "failed charge must not move the balance");

  tokens.refund(user.id, 2, "provider-failure");
  assert.equal(tokens.balanceOf(user.id), 5);
});

test("ledger records every movement", () => {
  const user = users.createUser({
    email: "ledger@test.local",
    name: "Ledger",
    passwordHash: crypto.hashPassword("a-long-test-password"),
    credits: 10,
  });
  tokens.charge(user.id, 2, "lookup:ip");
  const entries = tokens.ledgerFor(user.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].delta, -2);
  assert.equal(entries[0].balance_after, 8);
});

test("credential verification is case-insensitive on email", () => {
  const user = users.createUser({
    email: "MiXeD@Case.Local",
    name: "Mixed",
    passwordHash: crypto.hashPassword("a-long-test-password"),
  });
  assert.ok(users.checkCredentials("mixed@case.local", "a-long-test-password"));
  assert.equal(users.checkCredentials("mixed@case.local", "nope"), null);
});

test("suspended accounts cannot authenticate", () => {
  const user = users.createUser({
    email: "suspended@test.local",
    name: "Suspended",
    passwordHash: crypto.hashPassword("a-long-test-password"),
  });
  db.run("UPDATE users SET status = 'suspended' WHERE id = ?", user.id);
  assert.equal(users.checkCredentials("suspended@test.local", "a-long-test-password"), null);
});

/* ── pricing ────────────────────────────────────────────────────────── */

test("module cost honours the environment override", () => {
  assert.equal(tokens.costOf("phone"), 2);
  process.env.HAMSA_COST_TELEGRAM = "9";
  assert.equal(tokens.costOf("telegram"), 9);
});
