import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://hamsa:hamsa@127.0.0.1:5432/hamsa_test";
process.env.HAMSA_SECRET = "polaris-test-secret";

const { classifyCamera, CCTV_CATEGORIES } = await import("../lib/polaris/cctv.ts");
const relay = await import("../lib/polaris/cctv-relay.ts");

const cam = (parts) => ({ id: "x", name: "", city: "", sourceName: "", ...parts });

test("classifier: toll keywords", () => {
  assert.equal(classifyCamera(cam({ id: "binamarga-tol-1", name: "A", city: "B", sourceName: "S" })), "toll");
  assert.equal(classifyCamera(cam({ name: "Jalan Tol Jakarta", sourceName: "S" })), "toll");
});

test("classifier: city via /kota/ and overrides", () => {
  assert.equal(classifyCamera(cam({ name: "Alun-alun", city: "Kota Bandung", sourceName: "S" })), "city");
  // 'bendungan hilir' is a city (transit stop), not a dam
  assert.equal(classifyCamera(cam({ name: "Bendungan Hilir", city: "Jakarta", sourceName: "S" })), "city");
});

test("classifier: mountain requires a volcano word + monitoring hint", () => {
  assert.equal(
    classifyCamera(cam({ name: "Pantau Merapi", place: "Pengamatan", city: "Kabupaten Sleman", sourceName: "BPBD" })),
    "mountain",
  );
  assert.equal(classifyCamera(cam({ name: "Jalan Merapi", city: "Kabupaten X", sourceName: "S" })), "other");
});

test("classifier: dam word-matched, terminal/port substring-matched", () => {
  assert.equal(classifyCamera(cam({ name: "Waduk Saguling", city: "Kabupaten X", sourceName: "S" })), "dam");
  assert.equal(classifyCamera(cam({ name: "Terminal Leuwi Panjang", city: "Kota Bandung", sourceName: "S" })), "terminal");
  assert.equal(classifyCamera(cam({ name: "Pelabuhan Merak", city: "Kabupaten X", sourceName: "S" })), "port");
});

test("classifier: dam from source name", () => {
  assert.equal(
    classifyCamera(cam({ name: "Katulampa", city: "Kota Bogor", sourceName: "Pakuan Network · YouTube Live Bendung Katulampa" })),
    "dam",
  );
});

test("classifier: city from source name", () => {
  assert.equal(
    classifyCamera(cam({ name: "Sewon", city: "Kabupaten Bantul", sourceName: "Dinas Kominfo Gunungkidul" })),
    "city",
  );
});

test("categories match Phone-X R7 labels", () => {
  assert.deepEqual(
    CCTV_CATEGORIES.map((c) => c.label),
    ["SEMUA", "FAVORIT", "JALAN TOL", "KOTA", "GUNUNG", "BENDUNGAN", "TERMINAL", "PELABUHAN", "LAINNYA"],
  );
});

test("relay token: sign + resolve, expiry, tamper", () => {
  const token = relay.issueSegmentToken("https://upstream.example/playlist.m3u8");
  const url = relay.resolveSegment(token, "seg-1.ts");
  assert.equal(url, "https://upstream.example/seg-1.ts");
  const bad = relay.resolveSegment(token.slice(0, -4) + "aaaa", "seg-1.ts");
  assert.equal(bad, null);
  const abs = relay.resolveSegment(token, "https://other.example/x.ts");
  assert.equal(abs, "https://other.example/x.ts");
});

test("relay rewrite: segments proxied, tags untouched", () => {
  const token = relay.issueSegmentToken("https://u.example/p.m3u8");
  const out = relay.rewritePlaylist(
    "#EXTM3U\n#EXTINF:10,\nseg1.ts\n#EXT-X-ENDLIST\n",
    token,
    "/api/v1/osiris/cctv/bandung/abc",
  );
  const lines = out.split("\n");
  assert.equal(lines[0], "#EXTM3U");
  assert.equal(lines[1], "#EXTINF:10,");
  assert.ok(lines[2].startsWith("/api/v1/osiris/cctv/bandung/abc/segment?t="));
  assert.ok(lines[2].includes("s=seg1.ts"));
  assert.equal(lines[3], "#EXT-X-ENDLIST");
});
