# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-11-14

Phone-X capability parity: native intelligence modules, Polaris-X, public CCTV, Tango chains, OTP auth and token billing.

### Added

**Intelligence modules (15 total, all under `POST /api/v1/lookup`)**
- `hlr`, `whatsapp`, `getcontact`, `ewallet`, `breach`, `humint`, `public-evidence`, `name`, `domain`, `telegram-analytics` alongside `phone`, `ip`, `email`, `username`, `telegram`.
- Provider-gated: each module falls back to offline/public data and returns `warnings` describing what was missing instead of failing silently.
- Link graph (`POST /api/v1/graph`, `/graph` page) with weighted identity edges.
- QR tool (`POST /api/v1/qr`, `/tools/qr`): zxing-wasm decode plus inline-SVG encode via `qrcode-generator`.

**Polaris-X**
- BMKG earthquakes, GDACS alerts, OpenSky and adsb.lol aircraft, Celestrak satellites, NASA FIRMS hotspots, RSS news (`GET /api/v1/osiris/*`).
- Anonymous preview gate: 5 minutes active, 35 minutes cooldown, `POLARIS_PREVIEW_EXPIRED`.

**Public CCTV**
- 31-city catalogue with portal links; playable HLS/MJPEG/JPEG streams come from `HAMSA_PUBLIC_CCTV_<SLUG>`. Unset cities report `unavailable` with the reason.

**Geofence chains ("Tango")**
- Public `/t/<code>` collection page, HMAC geofint token, chain lifecycle and revocation, per-chain report wipe.
- Preview of uploaded stills reads EXIF GPS (JPEG/TIFF, RATIONAL 8-byte fix) and reports `found:false` when the image carries none.

**Phone OTP auth**
- `/api/v1/auth/web/{request-otp,verify-otp,login,logout,me,beta-status,password}` with `x-session-token`, `x-device-id` and `x-device-type`, alongside the existing cookie session.
- OTP delivery through `OTP_WEBHOOK_URL`/`OTP_WEBHOOK_TOKEN`, `OTP_DEV_MODE` for development, optional Cloudflare Turnstile.
- OTP-only accounts are created on first verification and can add a password later.

**Token billing**
- Six QRIS packs (Rp 40.000–1.200.000) and four USDT packs ($12.50–$75.00).
- Dynamic EMVCo payload builder (tag 54 amount, tag 62-05 reference, CRC16) from `HAMSA_QRIS_MERCHANT_PAYLOAD`; USDT deposits via `HAMSA_USDT_ADDRESS`/`HAMSA_USDT_NETWORK`.
- Idempotent settlement through an admin action or an HMAC-signed webhook; expiry committed outside the settlement transaction.

### Changed

- `users` gains `phone`, `whatsapp`, `gmail`, `phone_verified_at`, `requires_password`, `beta_user`; `sessions` gains `device_id`/`device_type`; new `otp_codes` and `topups` tables (migration `004`).
- New `geofence_chains` and `geofence_reports` tables (migration `005`).
- `authenticate()` accepts `x-session-token` in addition to cookies and bearer keys.
- Billing page lists all 15 modules and hosts the QRIS/USDT top-up panel.
- README and `docs/SECURITY.md` document the parity surface and deployment trust boundaries.

### Tests

- 58 tests, including 14 parity tests: OTP lifecycle and lockout, session-token auth, password login, idempotent settlement, expiry, plan pricing, QRIS warning, chain ownership/revocation, EXIF GPS round-trip and base64 decoding.

## [1.1.0] — 2026-10-22

PostgreSQL, own-asset camera monitoring and consent-based geofencing.

### Changed

- **PostgreSQL replaces SQLite.** `lib/db.ts` now wraps a `pg` pool; `DATABASE_URL` is required. All database helpers are asynchronous (`one`, `all`, `run`, `tx`, `withClient`), and `?` placeholders are translated to `$1..$n`.
- `lib/schema.ts` keeps the v1 shape as PostgreSQL DDL; `lib/migrations.ts` holds three reversible migrations with legacy data copy.
- Docker image now installs `ffmpeg`, runs with PostgreSQL as a sibling service, and mounts snapshots at `/app/storage`.
- Node 24 is the supported runtime.

### Added

**Camera monitor (own assets)**
- RTSP/HTTP stream enrolment with credentials split from the URL and encrypted with AES-256-GCM.
- ffmpeg probe, scheduled JPEG snapshots in private storage, and a pure-TS MOG2 background subtractor with configurable threshold and erosion.
- ONVIF PullPoint client (GetCapabilities → subscription → PullMessages) with WS-Security digest.
- Fail-closed authentication handling: a 401/403 disables the camera, notifies administrators, audits the event, and stops retries until an operator re-enables it.
- Owner-scoped snapshot route, retention pruning, and an authenticated `/api/v1/cron/cameras` scheduler.
- `/cctv` operator page with enrolment form, status, last error, thumbnails and recent events.

**Consent-based tracking**
- `tracked_devices`, `device_locations`, `geofences`, `geofence_events` and an append-only `notification` channel.
- One-time UUID consent token stored as a SHA-256 digest, instant revocation, uniform 403 for invalid/revoked tokens, 60 updates/minute/token.
- Haversine enter/exit transitions with duplicate suppression, device-scoped and org-wide fences, owner notifications and audit entries.
- `/tracking` operator page and `/api/v1/track/location` alias.

**Workspace**
- In-app notifications page with unread badge for camera alerts and geofence transitions.
- `npm run migrate` CLI (`up`, `down`, `status`), reversible down migrations and `tests/migrations.test.mjs` covering the full chain.
- Authorization reference is mandatory on every case and is recorded in the audit trail.

### Security

- Camera credentials and consent tokens are never returned unmasked; camera errors are redacted before persistence.
- Snapshots are stored outside `public/`, path-checked against the storage root, and owner-scoped at the route.
- `file://` camera inputs are rejected in production unless explicitly enabled for a demo.

### Tests

- 41 tests: unit tests plus PostgreSQL integration tests for migrations, camera enrolment/fail-closed/MOG2/ONVIF and consent/geofence HTTP semantics.
- Tests run serialized against `TEST_DATABASE_URL` (or a local `hamsa_test`) and never read production `DATABASE_URL`.

## [1.0.0] — 2026-10-22

First public release.

### Added

**Platform**
- Next.js 16 App Router application with React 19 Server Components and Server Actions.
- SQLite persistence through the built-in `node:sqlite` driver — no ORM, no migration tool, schema applied idempotently on boot.
- scrypt password hashing, server-side sessions stored as SHA-256 digests, httpOnly/SameSite cookies, role model (`admin`, `analyst`, `viewer`).
- Per-IP rate limits on authentication, per-user limits on lookups, per-device limits on position ingest.
- Append-only audit log covering authentication, lookups, exports, credit grants, key lifecycle, device pings and administrative changes.
- Enforced Content Security Policy, HSTS, framing denial, MIME-sniffing protection and a restrictive permissions policy.

**Intelligence modules**
- **Phone** — E.164 parsing and formatting, country and line type via libphonenumber metadata, carrier resolution through an offline prefix table or an optional Numverify key, investigation pivots.
- **IP** — IPv4/IPv6 classification (public, private, loopback, link-local, CGNAT, reserved), ASN/org and geolocation through ipinfo or ipwho.is, reverse DNS, proxy/hosting/mobile flags.
- **Email** — syntax validation, MX posture, disposable and role-account detection, Gravatar presence, Have I Been Pwned breach history when keyed.
- **Username** — bounded presence sweep across 22 curated platforms with soft-404 detection and per-site reliability ratings.
- **Telegram** — keyword search over a channel's public `t.me/s/` web preview, no account and no private-channel access.

**Workspace**
- Case files with a mandatory lawful purpose and authorization reference, evidence attach/detach, and an open/closed lifecycle.
- Lookup history with duration, provider attribution and stored payload; JSON, Markdown and print-to-PDF export.
- Credit ledger with an atomic overdraft guard, running balance and automatic refund when a provider fails.
- Watchlist with per-entry intervals and an authenticated cron endpoint; owners without credits are skipped rather than overdrawn.
- Consent-gated device tracking: one-time enrolment tokens, geofences evaluated with haversine distance, battery and accuracy telemetry.
- Own-asset camera register with AES-256-GCM encrypted endpoints and credentials plus TCP/HTTP reachability checks.
- Administration screen for operators, credit grants, encrypted provider credentials and the audit trail.

**API**
- `POST /api/v1/lookup` with session or bearer-key authentication and zod validation.
- `GET /api/v1/export/[id]` in JSON or Markdown.
- `POST /api/v1/device/ping` for consenting devices.
- `POST /api/v1/cron/watchlist` protected by `CRON_SECRET`.
- `GET /api/health` liveness and database probe.

**Delivery**
- Dockerfile (multi-stage, non-root, health-checked), Docker Compose file with a named data volume, and a CI workflow that typechecks, tests and builds.
- Documentation: architecture, API reference, security and threat model, deployment runbook, acceptable-use policy.
- 18 unit tests covering cryptography, geofence math, phone parsing, IP classification, credit atomicity, ledger integrity and account lockout.

### Security

- Production boot refuses to start when `HAMSA_SECRET` is missing or still the placeholder.
- Credential verification performs a hash comparison for unknown accounts to blunt timing-based user enumeration.
- Changing a password revokes every other session for the account.
- API keys and device tokens are stored only as digests and are shown once at creation.

### Known limitations

- No multi-factor authentication.
- In-process rate limiting; not shared across replicas.
- SQLite supports a single writer — suitable for a small team, not a large concurrent workload.
- Print-to-PDF relies on the browser's print dialog.
- The camera reachability probe can be pointed at arbitrary hosts; restrict enrolment to trusted operators.

[1.0.0]: https://github.com/aryarifki/Hamsa/releases/tag/v1.0.0
