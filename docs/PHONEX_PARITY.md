# Paritas Phone-X ↔ Hamsa — Hasil Reverse Engineering

Tanggal: 14 November 2026
Target A: https://phone-x.net (PhoneX — "Digital Intelligence Platform"), SaaS tertutup
Target B: /root/Hamsa (Hamsa OSINT Intelligence Console v1.1.0), self-hosted open code
Metode A: REA `analyze_javascript_application` (SPA bundle + chunk osiris + vendor chunk, inert-static) + probe endpoint publik (curl)
Metode B: baca kode sumber penuh (`lib/`, `app/`) + typecheck + test suite (bukti eksekusi lokal)
Bukti REA: `ev_6ef2d09fb329ee851db8df372fcd02e46c2bea6637f8ef4a5886a512eccd0154` (analysis view `ev_e49ac419…`), artefak `/tmp/opencode/phonex/`

---

## 1. Identitas arsitektur (semua `confirmed` dari bundle kecuali ditandai)

Phone-X:
- SPA Vite/React 19 + MapLibre/ReactFlow + zxing-wasm (QR). Cloudflare di depan; gate non-React `__root-gate/root-gate.js` memilih `_intro/index.html` vs `index.html` berdasarkan sesi `x-session-token` + `x-device-id` (sessionStorage/localStorage `@phonex:*`).
- Backend tidak terekspos source-nya (server-side closed). Endpoint yang ditemukan dari bundle frontend: 24 di main chunk, ~1000 di chunk osiris (mayoritas CCTV frame per kamera).
- Auth: OTP via WhatsApp/Gmail (`/api/auth/web/request-otp` menerima `phone, whatsapp, email, gmail, turnstileToken`; verifikasi `/api/auth/web/verify-otp` → `sessionToken`), login password (`/api/auth/web/login` dengan `identifier/identity/password`), session via header `x-session-token` + `x-device-id` (bukan cookie).
- Beta status publik: `betaEnabled=true, registrationLimit=11000, newBetaUsers=10830, remainingSlots=170`.
- Billing: token berbayar — paket QRIS Rp 40.000/10 token s.d. Rp 1.200.000/300 token (Rp 4.000/TX), atau USDT ($12.5–$75). Telegram search: messages=4 token, chats=4, analytics=8.
- Chunk osiris ("Polaris-X"): dashboard situasi publik Indonesia — CCTV 34 kota/kab (Bandung, Banyuwangi, Banjarmasin, Surabaya, Binamarga tol/nontol, dst.), BTS catalogue + in-area query, aviation (OpenSky/ADS-B), BMKG (gempa/cuaca/maritim), GDACS, fires, radar outages, AIS kapal, pelabuhan PIPP, energy (generator/BBM/transmisi), magma/volcano, satellite, self-track. Preview anonim 5 menit → cooldown 35 menit (`POLARIS_PREVIEW_EXPIRED`, `preview/status`).
- Fitur Geofence ("Tango"): `/api/geofint/token` + `/api/geofint/chains` (via bridge `smsbank.net/api/telegram/bridge` → di-proxy ke `/api/geofint`), chain dengan gambar base64 → "Tango link" (payload `{filename, imageBase64}`), plus laporan (`/reports`, DELETE untuk hapus).
- Modul intel berbayar per `phoneNumber`: HLR, WhatsApp, GetContact, e-wallet, breach, HUMINT (parsed dari `.json` harvester), public-evidence (sosial/marketplace/hosting/media), telegram; plus name lookup (`{name, location}`), email, domain, username, ip-lookup.
- Score model bobot: `getcontact_name:1, verified_ewallet_name:.9, telegram_name:.8, telegram_username:.7, humint_record:.7, community_record:.6, breach_name:.5, hlr_carrier_country:.6, whatsapp_registered:.7, email_match:.7, username_profile_match:.7`.

Hamsa (setelah implementasi paritas):
- Next.js 16 SSR + PostgreSQL, single process, sesi server-side cookie httpOnly **dan** header `x-session-token` (dual-auth), scrypt, AES-256-GCM untuk secret at rest.
- 15 modul lookup: phone, ip, email, username, telegram, hlr, whatsapp, getcontact, ewallet, breach, humint, public-evidence, name, domain, telegram-analytics — semuanya dispatch lewat `POST /api/v1/lookup`.
- Tool intel: QR decode/encode (`/api/v1/qr`), link graph (`/api/v1/graph`), Polaris-X (`/api/v1/osiris/*`), CCTV publik (`/api/v1/osiris/cctv/*`), geofence chain Tango (`/api/v1/geofint/*` + `/t/<code>`).
- Credits + billing: ledger atomik, refund on failure, harga per modul env; paket top-up QRIS/USDT dengan settlement idempoten.
- API key `hk_…` bearer; audit append-only; cases dengan authorization reference wajib; tracking consent-gated (token UUID, digest SHA-256, geofence haversine, 60/min); CCTV own-asset RTSP/ONVIF + ffmpeg + MOG2.

## 2. Matriks paritas fitur (status implementasi)

| Kapabilitas | Phone-X | Hamsa | Status |
|---|---|---|---|
| Phone E.164 + carrier | ✅ HLR + GetContact + offline | ✅ libphonenumber + prefix offline + Numverify optional | **setara** |
| HLR / carrier live | ✅ `/api/phone/hlr` | ✅ `lib/intel/hlr.ts` (provider key → offline prefix fallback + warning) | **setara** |
| WhatsApp registration check | ✅ `/api/phone/whatsapp` | ✅ `lib/intel/whatsapp.ts` | **setara** |
| GetContact names | ✅ | ✅ `lib/intel/getcontact.ts` (aggregator key → offline) | **setara** |
| E-wallet identity | ✅ | ✅ `lib/intel/ewallet.ts` (GoPay/OVO/DANA/ShopeePay) | **setara** |
| Breach data per phone/email | ✅ | ✅ `lib/intel/breach.ts` (HIBP + LeakCheck + local corpus) | **setara** |
| HUMINT / harvester records | ✅ | ✅ `lib/intel/humint.ts` (`HAMSA_HUMINT_DIR`) | **setara** |
| Public evidence (social/marketplace) | ✅ | ✅ `lib/intel/public-evidence.ts` + username sweep 22 platform | **setara** |
| IP lookup | ✅ (ipwho/ipapi/ip.sb) | ✅ ipwho/ipinfo + klasifikasi v4/v6 lokal | **setara+** |
| Email lookup | ✅ | ✅ + Gravatar + HIBP + disposable | **setara+** |
| Domain lookup | ✅ `/api/domain/lookup` | ✅ `lib/intel/domain.ts` | **setara** |
| Name/identity lookup | ✅ `/api/name/lookup` | ✅ `lib/intel/name.ts` | **setara** |
| Username presence | ✅ | ✅ 22 platform | **setara** |
| Telegram search | ✅ messages/chats | ✅ public preview per channel | setara |
| Telegram analytics | ✅ | ✅ `lib/intel/telegram-analytics.ts` | **setara** |
| Graph/relationship | ✅ graph-node + graph-recovery | ✅ `POST /api/v1/graph` + `/graph` page | **setara** |
| QR decoder | ✅ zxing-wasm | ✅ zxing-wasm decode + `qrcode-generator` encode | **setara+** (encode ditambah) |
| Geofence chain ("Tango") | via link ke target + bridge Telegram | ✅ native: `/t/<code>`, HMAC token, reports, EXIF-GPS preview | **setara** (tanpa bridge pihak ketiga) |
| CCTV publik | 34 kota, frame dari portal | ✅ katalog 31 kota + stream dari env operator | **setara** (katalog, bukan scraping) |
| Polaris-X | BMKG/aviation/AIS/fires/satellite/energy | ✅ BMKG, GDACS, OpenSky, adsb.lol, Celestrak, FIRMS, RSS | **setara** (AIS/energy belum ada feed) |
| Preview gate 5/35 menit | ✅ | ✅ `lib/intel/preview.ts` | **setara** |
| OTP auth + device headers | ✅ | ✅ `lib/auth-phonex.ts`, 7 route `/api/v1/auth/web/*` | **setara** |
| Beta gate | ✅ | ✅ `HAMSA_BETA_ENABLED` + `beta-status` | **setara** |
| Billing token QRIS/USDT | ✅ | ✅ 6 paket QRIS + 4 paket USDT, settle idempoten | **setara** |
| Cases/dossier + audit | ⚠️ history + saved + graph recovery | ✅ cases + authorization + audit append-only | **Hamsa lebih kuat** |
| API publik | ⚠️ `/api-access` (tidak terverifikasi detail) | ✅ `/api/v1/lookup` bearer key | setara |
| Rate limit | `likely` server-side (tidak teramati) | ✅ per-IP auth + per-user lookup + per-token device | Hamsa terdokumentasi |
| Deployment | SaaS closed (Cloudflare) | self-hosted Docker/single process | beda model |

### 2.1 Endpoint Hamsa ↔ Phone-X

| Phone-X | Hamsa |
|---|---|
| `POST /api/auth/web/request-otp` | `POST /api/v1/auth/web/request-otp` |
| `POST /api/auth/web/verify-otp` | `POST /api/v1/auth/web/verify-otp` |
| `POST /api/auth/web/login` | `POST /api/v1/auth/web/login` |
| `POST /api/auth/web/logout` | `POST /api/v1/auth/web/logout` |
| `GET /api/auth/web/me` | `GET /api/v1/auth/web/me` |
| `GET /api/auth/web/beta-status` | `GET /api/v1/auth/web/beta-status` |
| — | `POST /api/v1/auth/web/password` (tambahan: OTP account → password) |
| `POST /api/phone/hlr` | `POST /api/v1/lookup` `{module:"hlr"}` |
| `POST /api/phone/whatsapp` | `POST /api/v1/lookup` `{module:"whatsapp"}` |
| `POST /api/phone/getcontact` | `POST /api/v1/lookup` `{module:"getcontact"}` |
| `POST /api/phone/ewallet` | `POST /api/v1/lookup` `{module:"ewallet"}` |
| `POST /api/phone/breach` | `POST /api/v1/lookup` `{module:"breach"}` |
| `POST /api/phone/humint` | `POST /api/v1/lookup` `{module:"humint"}` |
| `POST /api/phone/public-evidence` | `POST /api/v1/lookup` `{module:"public-evidence"}` |
| `POST /api/name/lookup` | `POST /api/v1/lookup` `{module:"name"}` |
| `POST /api/domain/lookup` | `POST /api/v1/lookup` `{module:"domain"}` |
| Telegram search | `POST /api/v1/lookup` `{module:"telegram"}` / `{module:"telegram-analytics"}` |
| `POST /api/graph/node`, `/api/graph/recovery` | `POST /api/v1/graph` |
| QR decode | `POST /api/v1/qr` (decode + encode) |
| `GET /api/osiris/preview/status` | `POST /api/v1/osiris/preview/status` |
| `GET /api/osiris/bmkg` | `GET /api/v1/osiris/bmkg` |
| `GET /api/osiris/news` | `GET /api/v1/osiris/news` |
| Aviation (OpenSky/ADS-B) | `GET /api/v1/osiris/aviation/{opensky,adsb,satellites}` |
| CCTV catalogue / frame | `GET /api/v1/osiris/cctv/...` |
| `GET /api/geofint/token` | `POST /api/v1/geofint/token` |
| `POST /api/geofint/chains` | `POST /api/v1/geofint/chains` |
| `POST /api/geofint/chains/<code>/preview` | `POST /api/v1/geofint/chains/<code>/preview` |
| `DELETE /api/geofint/chains/<code>/reports` | `DELETE /api/v1/geofint/chains/<code>/reports` |
| — (billing hanya di UI) | `GET/POST /api/v1/topup`, `GET/DELETE /api/v1/topup/<ref>`, `GET /api/v1/tokens/balance` |

## 3. Verifikasi (bukti eksekusi lokal)

- `npx tsc --noEmit` → exit 0 (14 November 2026)
- `npm test` → seluruh suite pass, termasuk `tests/parity.test.mjs` **14/14** (OTP lifecycle, lockout, session token, password login, idempotensi settlement, expiry, harga paket, QRIS warning, chain public/owner/revoke, EXIF GPS, base64)
- `tests/migrations.test.mjs` diperbarui untuk 5 migrasi (`001`–`005`) dengan rollback berurutan dan pengecekan kolom.
- Catatan: test butuh `TEST_DATABASE_URL` dari `.env`; fallback `hamsa:hamsa` gagal auth karena role `hamsa` tidak ada di PG lokal — bukan defect aplikasi.

## 4. Environment parity

| Variabel | Fungsi |
|---|---|
| `OTP_WEBHOOK_URL`, `OTP_WEBHOOK_TOKEN` | adapter pengiriman OTP (WhatsApp/SMS gateway) |
| `OTP_DEV_MODE` | kode dikembalikan sebagai `devCode` di response (dev only) |
| `HAMSA_TURNSTILE_SECRET` | verifikasi Cloudflare Turnstile di endpoint OTP |
| `HAMSA_BETA_ENABLED`, `HAMSA_REGISTRATION_ENABLED`, `HAMSA_REGISTRATION_LIMIT` | gate beta + pendaftaran |
| `HAMSA_QRIS_MERCHANT_PAYLOAD` | payload EMVCo statis; Hamsa menambahkan tag 54 + 62-05 dan CRC16 |
| `HAMSA_USDT_ADDRESS`, `HAMSA_USDT_NETWORK` | alamat deposit + label jaringan |
| `HAMSA_TOPUP_WEBHOOK_SECRET` | HMAC-SHA256 untuk `POST /api/v1/topup/webhook` |
| `HAMSA_PUBLIC_CCTV_<SLUG>` | daftar URL stream per kota (comma-separated) |
| `HAMSA_HUMINT_DIR` | direktori record HUMINT (`.json`/`.jsonl`) |
| `FIRMS_MAP_KEY` | hotspot kebakaran NASA FIRMS |
| `GETCONTACT_API_URL/_KEY`, `EWALLET_API_URL/_KEY` | endpoint aggregator opsional |
| `LEAKCHECK_API_KEY` | breach tambahan selain HIBP |
| `HAMSA_COST_*` (15 modul) | harga per modul; default: 2/2/3/3/4/4/4/4/4/4/8/4/4/4/8 |

## 5. Limitations & unknowns

- Analisis Phone-X murni statis terhadap bundle frontend (`inert text`; REA tidak mengeksekusi bundle). Perilaku backend hanya teramati lewat beberapa probe endpoint publik (`preview/status`, `beta-status`, error shapes). Semua klaim sisi server Phone-X = `likely`, bukan `confirmed`.
- APK Android tidak ditemukan sebagai file nyata (`/app.apk` dll. mengembalikan HTML gate — SPA). Mungkin distribusi via link privat; `unverified`.
- Harga token per modul selain telegram-search (4/4/8) tidak ditemukan eksplisit di bundle; Hamsa memakai cost map sendiri yang dapat di-override per deployment.
- Endpoint `/api/osiris/*` memerlukan preview session aktif atau login; tidak diuji lebih jauh (passive only, tanpa akun).
- REA worker heap exhaustion pada bundle 2.4 MB → semantic graph `partial`; endpoint extraction dilakukan regex terpisah sebagai kompensasi (hasil konsisten dengan graph REA).
- Modul provider-gated (HLR, GetContact, e-wallet, breach, FIRMS) mengembalikan hasil offline/parsial + `warnings` bila key tidak diset — bukan kegagalan senyap.
- Katalog CCTV berisi tautan portal; stream hanya diputar bila operator mengisi `HAMSA_PUBLIC_CCTV_<SLUG>`. Tidak ada scraping portal pihak ketiga.
- Feed AIS dan energy (generator/BBM/transmisi) yang ada di Polaris-X belum punya sumber publik gratis yang setara; endpoint-nya belum dibuat.

## 6. Polaris dashboard parity (update 15 November 2026)

Reverse engineering chunk Polaris-X (`osiris-polaris-bts-retention-r3-20261113.js`, 8.7 MB) →
14 modul split parse-OK, REA `ev_a147120eb04e36b7bab3bbdd1f4ad0ad010d06e1990d16d276feba485e29700b`
(301k AST nodes, 161 findings). Referensi UI lengkap:
`/root/.local/share/phonex-re/POLARIS_UI_REFERENCE.md`.

### 6.1 Yang direplikasi (first-party, tanpa proxying ke Phone-X)

| Elemen | Polaris-X | Hamsa | Status |
|---|---|---|---|
| Shell | `<main class="osiris">` full-viewport, peta MapLibre full-bleed | `components/polaris/Dashboard.tsx` overlay fixed z-60 di atas console + tombol EXIT (deviasi minimal: Hamsa punya sidebar) | **setara** |
| CSS | 13 blok stylesheet embedded (126 KB, 617 rule `.osiris`, font "Polaris Oxanium" 800) | diekstrak utuh → `app/(console)/polaris/polaris.css`; font Oxanium ExtraBold (OFL) self-host di `public/fonts/Oxanium-ExtraBold.ttf`; interpolasi JS `${Sa}`→`#67d9bb`, `${jt}`→path mask; + blok CSS first-party untuk shell/EXIT/presence/gate/popups | **setara** |
| Left tools (11) | home, self-track, hazards, flights, cctv, bts, maritime, energy, datacenter, satellite, maintenance | semua 11 tool dirender, urutan & label sama | **setara** |
| Modes | 3D/2D (projection globe/mercator, globe hanya zoom<12) + MAP/SAT (SAT = ArcGIS World_Imagery `server.arcgisonline.com`) | sama; persist di localStorage | **setara** |
| Hazards | 4 toggle (EARTHQUAKES BMKG+USGS / ACTIVE FIRES FIRMS / SEVERE WEATHER EONET,NOAA,NWS,GDACS / VOLCANOES MAGMA-PVMBG) + count badge | sama; data dari `/api/v1/osiris/bmkg` (quakes/disasters/fires); volcanoes count 0 (tidak ada feed) | **setara** |
| Flights | panel + switch layer, kategori airborne/ground (#24d9ef/#9aafc0), bar proporsi, scope dropdown (indonesia/sea/asia/europe/middle-east/us/current/global), CALLSIGN search | sama (OpenSky via Hamsa); center/zoom per scope dari bundle (sea [108,7] z3.35, asia [86,31] z2.45, europe [12,52] z3.05, me [46,27] z3.45, us [-98,39] z2.65) | **setara** |
| Space | "SPACE TRACKING", kategori i5 (ALL/STARLINK/MILITARY/GPS/EARTH OBS/STATIONS), CelesTrak | panel + list stations CelesTrak saja; kategori lain **tidak difabrikasi** (tanpa data lokal) | **parsial (jujur)** |
| CCTV | kategori kota + FAVORIT, grid, pagination, favorites localStorage, player HLS/mp4/flv/jsmpeg/youtube | parity penuh — lihat §7: 9 kategori keyword-based, 5818 kamera (bundle 2841 + runtime 2977), HLS player ke relay/direct first-party, preview popup + monitor 1×1/2×2 di atas peta | **setara (§7)** |
| Presence | `POST /api/polaris/presence/heartbeat` `{visitorId}` 25s saat tab visible, window 90s, `{activeVisitors}` | `POST /api/v1/polaris/presence/heartbeat` — wire-shape sama, in-memory Map TTL 90s, rate limit 40/min/IP, UUID v4 divalidasi | **setara** |
| Owner media | `POST /api/osiris/owner-media-session` → `{expiresAt}` (proof, poll 60s) | dihapus (model §7: player HLS Phone-X tidak gating owner media) | **n/a** |
| Ticker | atas: news ● LIVE (hover-pause, click detail); bawah: cluster quake berwarna per magnitudo + separator `\|` | sama; data RSS Hamsa + BMKG; warna quake M≥6 #ff5353 / M≥5 #ff9a3d / M≥4 #ffd51c / else #44ef99 | **setara** |
| Readout | ZULU clock / STATUS: LIVE / SOURCE STANDBY + cursor readout koordinat | ZULU / STATUS LIVE-STANDBY / PREVIEW countdown + cursor readout | **setara** |
| Preview gate | anonim 5 menit → cooldown 35 menit (`POLARIS_PREVIEW_EXPIRED`) | overlay Polaris-style saat preview closed; feed hanya ditarik saat preview aktif (guardrail biaya tetap) | **setara** |

### 6.2 SOURCE UNAVAILABLE (keputusan desain)

Feed Polaris-X yang Hamsa belum jalankan (AIS kapal, pelabuhan PIPP, rute pelayaran, energy
generator/transmisi/BBM, datacenter, BTS OpenCelliD) dirender panel dengan struktur identik
tapi state **SOURCE UNAVAILABLE** — bukan data karangan. Panel memakai kelas CSS Polaris-X
asli (`osiris-maritime-panel`, `osiris-energy-panel`, `polaris-dc-panel`, `osiris-bts-panel`).

### 6.3 Pengaturan & persistensi (Hamsa keys, bukan `phonex:*`)

| Key | Isi |
|---|---|
| `hamsa:polaris:ui:v1` | mode (3d/2d), basemap (map/sat), layers, hazards |
| `hamsa:polaris:cctv-favorites:v1` | array `<camera-id>` (Phone-X parity — key murni id kamera, tanpa prefix slug) |
| `hamsa:polaris:visitor:v1` | UUID v4 presence |

### 6.4 Endpoint baru

- `POST /api/v1/polaris/presence/heartbeat` — presence 90s window (tanpa auth, rate-limited, UUID validated).

Endpoint Hamsa yang dikonsumsi dashboard: `/api/v1/osiris/{preview/status,bmkg,aviation/opensky,
aviation/satellites,news,polaris/cctv/catalogs}` + relay `/api/v1/osiris/cctv/<slug>/<id>/{index.m3u8,segment}`.

### 6.5 Verifikasi (15 November 2026)

- `npm run typecheck` → exit 0.
- `npm test` → **58/58 pass** (setelah perbaikan env DB lokal: role `hamsa`+grant `hamsa_test`, ownership tabel `hamsa_test` dialihkan ke `hamsa`; kegagalan 50-test sebelumnya murni env, bukan kode).
- `npm run build` → exit 0; route `/polaris` terdaftar. Catatan build: interpolasi `${...}` pada CSS ekstrak memicu `CssSyntaxError` Turbopack — diselesaikan dengan substitusi literal.
- Login Phone-X tidak pernah dipakai; seluruh temuan dari static bundle (`likely` untuk sisi server Phone-X, `confirmed` untuk UI/bundle).

## 7. CCTV Polaris-X parity penuh (update 16 November 2026)

Replikasi penuh model CCTV Phone-X menggantikan model 31-kota env-based.

- **Data**: static bundle `data/polaris-cctv-cameras.json` (2841 kamera) + 7 runtime katalog
  (`data/polaris-cctv-catalogs/{bandung,banyuwangi,bojonegoro,depok,gresik,malangkota,semarang}.json`,
  2977 kamera, zero overlap id) → **5818 kamera**. Bundle di-load client sebagai dynamic import chunk
  terpisah (~2 MB, hanya saat tool CCTV aktif); runtime katalog dari endpoint first-party
  `GET /api/v1/osiris/polaris/cctv/catalogs`. Salatiga persisten 502 → `unavailable`.
- **Kategori**: 9 kategori keyword-based (`R7` port exact ke `lib/polaris/cctv.ts`: SEMUA/FAVORIT/
  JALAN TOL/KOTA/GUNUNG/BENDUNGAN/TERMINAL/PELABUHAN/LAINNYA) — classifier `Gn` + `wr` word-match,
  bukan model per-kota lama.
- **Upstream registry** (diverifikasi dari server): **server relay** bandung
  (pelindung.bandung.go.id:3443, no CORS) + depok (dishub.depok.go.id, CORS dsw.depok.go.id only);
  **client direct** semarang (livepantau, CORS *) + seluruh bundle direct-hls (balitower dll);
  **hidden → failure state asli Phone-X**: molecool, tangerang (Filament+Livewire butuh login),
  banyuwangi (`wt` base 404), malangkota, gresik (unavailable), salatiga (502), ponorogo (endpoint
  stream butuh Bearer token Phone-X).
- **Relay server-side** (`lib/polaris/cctv-relay.ts`): playlist di-fetch server, segment URL
  di-rewrite ke `/segment?t=<hmac>&s=<relpath>` — upstream URL tidak pernah sampai client; token
  TTL 10 menit, HMAC-SHA256, in-memory map, timing-safe compare. Rate limit 120 relay + 600
  segment/menit/user. Master playlist variant di-rewrite rekursif.
- **Player** (`components/polaris/cctv-players.tsx`): `Nr` port (hls.js dengan watchdog frame
  20 detik, source fallback direct→relay, retry 60 detik), `Qs` port router (youtube → iframe,
  ponorogo-mse → failure state, lainnya HLS), `ia` port detail. Relay path Phone-X
  `/api/osiris/cctv/` di-rewrite ke `/api/v1/osiris/cctv/` client-side.
- **UI** (`components/polaris/cctv-panel.tsx`, `cctv-layer.tsx`): `Kv` kategori panel, `fv` preview
  popup (MapLibre Popup + sort live-first + navigasi multi-kamera per titik), `wv` viewer monitor
  1×1/2×2 dengan fullscreen CSS-fallback + pagination, `Pv` tile, `C5` map layer (icon CCTV SDF
  putih + `icon-color:#ffd51c` kuning, halo #02050a, cluster maxZoom 10 radius 48, label 2-baris)
  + selection pulse `Fa`. Marker kuning, bukan biru.
- **Integrasi**: hapus model lama (route `osiris/cctv/[city]/*`, `lib/cctv/public-feeds.ts`
  unused, halaman console `/osiris-cctv`, owner-media gating — Phone-X HLS player tidak gating).
  Favorites key = `camera.id` murni (Phone-X parity). Status dari player meng-override via
  `statusOverrides`.
- **Verifikasi 16 November 2026**: typecheck exit 0; `npm test` **67/67 pass** (9 baru: classifier
  word-match, kategori, relay token sign/tamper/expiry, playlist rewrite tags); `npm run build`
  exit 0; relay bandung+depok 200 (segment rewritten, `video/MP2T` 192 KB OK, tamper 403);
  hidden slug → 502 `upstream_unavailable` (Cloudflare menggantikan body JSON 502 dengan error
  page sendiri — player tetap lihat non-200 → failure state, perilaku fungsional sama).
