# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
