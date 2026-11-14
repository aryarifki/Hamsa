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
