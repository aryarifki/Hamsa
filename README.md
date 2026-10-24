# Hamsa — OSINT Intelligence Console

**Self-hosted investigative workspace for authorized OSINT.** Phone metadata, IP attribution, email exposure, username presence and public-channel monitoring — bound to a case file, metered by credits, and recorded in an append-only audit log. It also monitors the cameras you own and the devices whose owners consented to share their position.

```
  ┌─────────────────────────────────────────────────────────────┐
  │  HAMSA                                                      │
  │  ─────────────────────────────────────────────────────────  │
  │  Next.js 16 · React 19 · PostgreSQL 15+ · ffmpeg · no ORM   │
  │  Single app process · external database · private storage   │
  └─────────────────────────────────────────────────────────────┘
```

[![CI](https://github.com/aryarifki/Hamsa/actions/workflows/ci.yml/badge.svg)](https://github.com/aryarifki/Hamsa/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A524-339933)
![License](https://img.shields.io/badge/license-MIT-d9b26a)

---

## What this is

Hamsa is a **complete, original implementation** of an OSINT console: an operator signs in, opens a case, runs lookups, attaches evidence, exports a dossier. Every action is attributed, priced where a lookup runs, and logged.

It is **not** a copy of any commercial service, and it ships no proprietary data feeds, keys or branding. Where a capability needs a paid provider, you bring your own key; where it can work offline, it does.

## What this is not

Hamsa deliberately does **not** implement:

- **Phone-number → real-time location.** Position data exists only for devices that were enrolled with a recorded consent reference and voluntarily POST their coordinates.
- **Third-party camera access or discovery.** The camera module only pulls streams you enrol yourself. There is no vendor key, no scanning for exposed cameras, and no live-video proxying — only scheduled stills and motion events.
- **Private Telegram scraping.** Only the public `t.me/s/` web preview of channels that already publish it.

These are product decisions, not missing features. See [docs/ACCEPTABLE_USE.md](docs/ACCEPTABLE_USE.md) and the engagement templates in [docs/authorization/](docs/authorization/README.md).

---

## Feature matrix

| Area | What you get |
| --- | --- |
| **Auth** | scrypt password hashing, server-side sessions (SHA-256 digests), httpOnly/SameSite cookies, per-IP rate limits, role model (`admin` / `analyst` / `viewer`), password rotation with session revocation |
| **Phone** | E.164 parsing and formatting, country/region, line type, carrier (provider or offline prefix table), investigation pivots |
| **IP** | v4/v6 classification (private, loopback, CGNAT, reserved), ASN/org, geolocation, proxy/hosting flags, reverse DNS |
| **Email** | syntax + MX posture, disposable and role-account detection, Gravatar, HIBP breach history (optional key) |
| **Username** | bounded presence sweep across 22 curated platforms with soft-404 detection |
| **Telegram** | keyword search over a public channel's web preview, no account required |
| **Cases** | legal purpose + authorization reference are mandatory; evidence attach/detach; open/close lifecycle |
| **Credits** | atomic debit guard, ledger with running balance, automatic refund on provider failure, per-module pricing |
| **History** | every lookup stored with duration, provider and payload; JSON / Markdown / print-to-PDF export |
| **Monitoring** | watchlist with per-entry interval, scheduler endpoint, credit-aware skipping, drift-friendly stored results |
| **Tracking** | consent-gated position ingest, one-time UUID token (SHA-256 at rest), instant revocation, 60 updates/min per token, haversine geofences with enter/exit events |
| **Cameras** | own-asset RTSP/ONVIF monitor, AES-256-GCM credentials, scheduled stills in private storage, MOG2 motion, optional ONVIF PullPoint events, fail-closed on 401/403 |
| **Notifications** | in-app inbox for camera fail-closed alerts (admins) and geofence transitions (device owner) |
| **Admin** | operator management, credit grants, encrypted provider credentials, audit trail browser |
| **API** | `POST /api/v1/lookup` with bearer keys or session cookie; scoped key management |

---

## Quick start

### 1. PostgreSQL

Hamsa requires PostgreSQL 15 or newer. Any managed instance works; locally:

```bash
createdb hamsa
createdb hamsa_test       # used by npm test
```

If you prefer Docker:

```bash
docker run -d --name hamsa-pg \
  -e POSTGRES_USER=hamsa -e POSTGRES_PASSWORD=hamsa -e POSTGRES_DB=hamsa \
  -p 127.0.0.1:5432:5432 postgres:17-alpine
```

### 2. Local development

```bash
git clone https://github.com/aryarifki/Hamsa.git
cd Hamsa
cp .env.example .env

# generate a real secret — required before production
openssl rand -base64 48   # paste into HAMSA_SECRET

# point DATABASE_URL at your database, e.g.
# DATABASE_URL=postgres://hamsa:hamsa@127.0.0.1:5432/hamsa
npm install
npm run migrate up        # optional: the app also applies schema + migrations on boot
npm run dev               # http://localhost:3000
```

On first boot Hamsa creates an administrator from `HAMSA_ADMIN_EMAIL` / `HAMSA_ADMIN_PASSWORD` and applies the baseline schema plus every pending migration. Change that password from **Settings → Change password** immediately.

Optional demo data:

```bash
npm run seed   # analyst@hamsa.local / hamsa-demo-passphrase (250 credits)
```

### 3. Docker Compose

```bash
cp .env.example .env      # set HAMSA_SECRET and POSTGRES_PASSWORD
docker compose up -d --build
```

Compose starts PostgreSQL and the app, waits for the database health check, applies migrations on boot, and keeps snapshots in the `hamsa-storage` volume (`/app/storage`). The app binds to `127.0.0.1:3000`; put a TLS proxy in front.

### 4. Production notes

```bash
npm ci
npm run build
NODE_ENV=production HAMSA_SECURE_COOKIES=true npm start
```

Hamsa refuses to start in production if `HAMSA_SECRET` is missing or still the placeholder — otherwise provider keys and camera passwords would be encrypted with a publicly known key. `ffmpeg` must be on `PATH` (or `HAMSA_FFMPEG_PATH`) for camera capture.

---

## Configuration

All settings are environment variables; none are required to boot except in production.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HAMSA_SECRET` | — | **Required in production.** Derives the AES-256-GCM key for secrets at rest |
| `DATABASE_URL` | — | **Required.** `postgres://user:pass@host:5432/hamsa` |
| `HAMSA_PG_POOL` | `10` | Maximum PostgreSQL connections held by the app |
| `TEST_DATABASE_URL` | local `hamsa_test` | Database used by `npm test`; never point at production |
| `HAMSA_ADMIN_EMAIL` | `admin@hamsa.local` | Bootstrap administrator |
| `HAMSA_ADMIN_PASSWORD` | `change-this-on-first-login` | Bootstrap password — rotate immediately |
| `HAMSA_SIGNUP_CREDITS` | `25` | Credits granted on registration |
| `HAMSA_COST_PHONE` / `_IP` / `_EMAIL` / `_USERNAME` / `_TELEGRAM` | `2/2/3/3/4` | Per-lookup pricing |
| `HAMSA_AUTH_RATE_LIMIT` | `10` | Login/register attempts per IP per minute |
| `HAMSA_SECURE_COOKIES` | `false` (auto in prod) | Force `Secure` on the session cookie |
| `HAMSA_ALLOW_FREE_PROVIDERS` | `true` | Set `false` to forbid keyless IP lookups (fully offline mode) |
| `HAMSA_STORAGE_DIR` | `./storage` | Private root for camera snapshots — never inside `public/` |
| `HAMSA_FFMPEG_PATH` | `ffmpeg` | ffmpeg binary used for probes, stills and motion frames |
| `HAMSA_CCTV_ALLOW_LOCAL_MEDIA` | `false` in production | Allow `file://` inputs for the local demo only |
| `HAMSA_MOTION_THRESHOLD` | `0.01` | Default foreground ratio (1%) for motion; per-camera override |
| `HAMSA_SNAPSHOT_RETENTION_DAYS` | `14` | Snapshot metadata + files pruned after this age |
| `HAMSA_CAMERA_BATCH` | `5` | Cameras processed per cron pass (max 25) |
| `IPINFO_TOKEN` | — | Preferred IP provider |
| `NUMVERIFY_KEY` | — | Carrier lookup provider |
| `HIBP_API_KEY` | — | Breach history |
| `CRON_SECRET` | — | Required by both cron endpoints |

Provider keys can also be set by an administrator in **Admin → Provider credentials**; a stored key overrides the environment.

---

## Cameras (own assets)

Camera credentials are split out of the stream URL and encrypted with AES-256-GCM. The stored URL keeps only scheme, host, port and path, so a database dump does not reveal the password; error messages are redacted before they are persisted.

1. Put `ffmpeg` on the server (the Docker image includes it).
2. Open **Cameras → Enrol a camera** and enter `rtsp://host:554/Streaming/Channels/101` plus the username/password if required. Add the ONVIF host (`host:port`) if the camera supports PullPoint events.
3. Click **Check** to probe the stream, then **Snapshot** to capture now. The cron endpoint captures on schedule.

A wrong password (HTTP 401/403 from the camera) sets the camera to `disabled_auth`, writes an audit entry, notifies every administrator, and stops touching the camera. Fix the credentials and click **Re-enable**. Other failures are retried and counted; the status and last error are visible in the table.

Snapshots are written to `HAMSA_STORAGE_DIR/cameras/<camera-id>/<timestamp>.jpg` with a `0700` directory. They are served only through `GET /api/v1/cctv/snapshot/[id]`, which checks that the caller owns the camera (or is an admin), and the file path is validated against the storage root before it is read.

### Local demo without a camera

```bash
# a 30-second animated test clip
ffmpeg -f lavfi -i testsrc=size=640x480:rate=10 -t 30 -pix_fmt yuv420p /tmp/hamsa-demo.mp4

# allow local media for this dev shell only
HAMSA_CCTV_ALLOW_LOCAL_MEDIA=true npm run dev
```

Enrol `file:///tmp/hamsa-demo.mp4` as the stream URL. `file://` is rejected when `NODE_ENV=production` unless `HAMSA_CCTV_ALLOW_LOCAL_MEDIA=true` is set explicitly.

### ONVIF

Hamsa implements ONVIF PullPoint only: `GetCapabilities → CreatePullPointSubscription → PullMessages`. Cameras that can only push notifications to a callback are not supported; use their RTSP + MOG2 path instead. The SOAP call uses WS-Security UsernameToken digest when credentials are present.

---

## Lab devices (consent-based tracking)

```bash
# 1. Enrol in Tracking → Register a consenting device.
#    The UUID token is shown once. Only its SHA-256 digest is stored.

# 2. The device reports its own position.
curl -X POST https://your-host/api/v1/device/ping \
  -H "Authorization: Bearer <consent-token>" \
  -H "Content-Type: application/json" \
  -d '{"lat": -6.2005, "lon": 106.8005, "accuracy": 8, "battery": 77}'
```

`/api/v1/track/location` is an alias of the same handler. Unknown, malformed and revoked tokens all return the same `403 {"error":"Forbidden"}` — the endpoint never confirms whether a device exists. Accepted updates are limited to 60 per minute per token.

A geofence can be scoped to one device or to the whole organisation (`device_id IS NULL`). The first accepted position inside a fence records `enter`; a later position outside records `exit`; repeats are suppressed from the latest stored event. Owners get an in-app notification, and `geofence.create`, `geofence.enter`, `geofence.exit` are written to the audit log.

The product still has **no phone-number → location path**. A position exists only because a consenting device sent it.

---

## Scheduler

Both endpoints accept `x-cron-secret: $CRON_SECRET` or `Authorization: Bearer $CRON_SECRET`:

```cron
*/1 * * * * curl -fsS -X POST https://hamsa.example.org/api/v1/cron/cameras \
  -H "x-cron-secret: $CRON_SECRET" >/dev/null

*/15 * * * * curl -fsS -X POST https://hamsa.example.org/api/v1/cron/watchlist \
  -H "x-cron-secret: $CRON_SECRET" >/dev/null
```

The camera pass is bounded by `HAMSA_CAMERA_BATCH`, skips disabled/needs-config cameras, captures only when the camera's interval has elapsed, and prunes snapshots older than the retention window. The watchlist pass runs at most 10 due entries and never overdrafts an owner.

---

## How a lookup runs

```
POST /api/v1/lookup
        │
        ├─ authenticate (session cookie or `hk_…` bearer)
        ├─ rate limit (60/min per user or key)
        ├─ validate with zod
        ├─ charge credits ──── atomic UPDATE … WHERE credits >= cost
        ├─ persist `queued` row
        ├─ dispatch module ─── offline metadata → optional provider
        ├─ persist payload + duration
        ├─ append audit entry
        └─ on failure: refund credits, mark `error`, return 502
```

Nothing is charged for a lookup that fails. Nothing is stored without an owning user.

---

## API

### Authenticate

```bash
# session cookie (browser) or an API key created in Settings
curl -X POST https://your-host/api/v1/lookup \
  -H "Authorization: Bearer hk_xxx_yyy" \
  -H "Content-Type: application/json" \
  -d '{"module":"phone","target":"+6281234567890"}'
```

```json
{
  "lookupId": "3eb145b7-…",
  "module": "phone",
  "target": "+6281234567890",
  "cost": 2,
  "balance": 248,
  "durationMs": 14,
  "result": {
    "signals": [{ "label": "Number passes E.164 validation", "level": "info" }],
    "sources": [{ "name": "libphonenumber (offline metadata)", "kind": "offline" }],
    "data": { "e164": "+6281234567890", "carrier": "Telkomsel", "type": "MOBILE" }
  }
}
```

Full reference: [docs/API.md](docs/API.md).

---

## Architecture

```
app/
  (auth)/            login, register, server actions
  (console)/         authenticated shell + all operator screens
  api/v1/            lookup, export, device ingest, snapshot, cron, health
lib/
  db.ts              PostgreSQL pool, typed helpers, transactions, migrations
  migrations.ts      reversible schema changes with data copy
  crypto.ts          scrypt, AES-256-GCM, tokens
  users/auth         credentials vs. request-scoped session (testable split)
  tokens.ts          credit ledger with an atomic overdraft guard
  lookup.ts          orchestration: charge → run → persist → refund on error
  cctv/              ffmpeg runner, MOG2, ONVIF client, service + storage
  track/             consent tokens and the geofence engine
  notify.ts          in-app notification channel
  intel/             phone, ip, email, username, telegram, geo
components/          design system + renderers (no UI framework dependency)
docs/                architecture, API, security, deployment, acceptable use, authorization
scripts/             migrate, seed, TS resolver for tests
tests/               41 tests against real PostgreSQL + ffmpeg-free fakes
```

No ORM, no component library, no state manager, no chart library: the database layer is a small `pg` wrapper, the design system is CSS custom properties plus a dozen utility classes, and the map/graph visuals are inline SVG. Fewer moving parts means fewer upgrade paths that break.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Testing

```bash
# one-time: create the test database
createdb hamsa_test

npm test        # 41 tests: unit + PostgreSQL integration, serialized
npm run typecheck
npm run build
```

`npm test` resolves the database from `TEST_DATABASE_URL`, falling back to `postgres://hamsa:hamsa@127.0.0.1:5432/hamsa_test` — it never reads production `DATABASE_URL`. Tests reset the tables they use and must be run serialized (`--test-concurrency=1` is set in the script).

Covered: crypto and tamper detection, haversine/geofence math, E.164 normalization, IP classification, credit atomicity, sessions, migration up/down/re-up with legacy data, MOG2 static/noise/object frames, camera enrolment and credential splitting, fail-closed authentication, snapshot storage, ONVIF PullPoint parsing, consent token mint/revoke/403 and the 60/min limit, and enter/exit transitions.

Camera and ONVIF tests inject a fake runner/transport, so they need neither a real camera nor network access.

---

## Security posture

- CSRF: server actions are same-origin by construction; the only JSON endpoint requires an `Authorization` header or the session cookie with `SameSite=Lax`.
- CSP is **enforced** (`script-src 'self'`), not report-only; framing denied; MIME sniffing disabled.
- Sessions are 256-bit random tokens stored as SHA-256 digests; revocation is server-side.
- Provider credentials and camera passwords are encrypted with AES-256-GCM derived from `HAMSA_SECRET`; camera URLs are stored without userinfo.
- Consent tokens are UUIDs stored as SHA-256 digests, displayed once, revocable, and rejected with a uniform 403 when invalid or revoked.
- Snapshots live outside `public/`, are owner-scoped through an authenticated route, and are excluded from version control.
- Audit entries are written server-side only and are append-only by convention (no update/delete path exists in the code).
- Login always performs a hash comparison, so unknown accounts and wrong passwords take comparable time.

Threat model and known limitations: [docs/SECURITY.md](docs/SECURITY.md).

---

## Legal

Hamsa is an investigation tool. Using it against people without a lawful basis may be illegal in your jurisdiction, and the audit trail is designed to make that attributable. Read [docs/ACCEPTABLE_USE.md](docs/ACCEPTABLE_USE.md) and keep an authorization record per engagement ([docs/authorization/](docs/authorization/README.md)) before deploying.

This project is independent and unaffiliated with any commercial OSINT service. It contains no third-party proprietary code, assets or credentials.

## License

MIT © 2026 aryarifki — see [LICENSE](LICENSE).
