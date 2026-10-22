# Hamsa — OSINT Intelligence Console

**Self-hosted investigative workspace for authorized OSINT.** Phone metadata, IP attribution, email exposure, username presence and public-channel monitoring — bound to a case file, metered by credits, and recorded in an append-only audit log.

```
  ┌─────────────────────────────────────────────────────────────┐
  │  HAMSA                                                      │
  │  ─────────────────────────────────────────────────────────  │
  │  Next.js 16 · React 19 · node:sqlite · zero ORM             │
  │  Single process · single file database · no external queue  │
  └─────────────────────────────────────────────────────────────┘
```

[![CI](https://github.com/aryarifki/Hamsa/actions/workflows/ci.yml/badge.svg)](https://github.com/aryarifki/Hamsa/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933)
![License](https://img.shields.io/badge/license-MIT-d9b26a)

---

## What this is

Hamsa is a **complete, original implementation** of an OSINT console: an operator signs in, opens a case, runs lookups, attaches evidence, exports a dossier. Every action is attributed, priced and logged.

It is **not** a copy of any commercial service, and it ships no proprietary data feeds, keys or branding. Where a capability needs a paid provider, you bring your own key; where it can work offline, it does.

## What this is not

Hamsa deliberately does **not** implement:

- **Phone-number → real-time location.** Position data exists only for devices that were enrolled with a recorded consent reference and voluntarily POST their coordinates.
- **Third-party camera access.** The camera module is an inventory/reachability register for streams *you* own; there is no vendor key, no scanning for exposed cameras, and no video proxying.
- **Private Telegram scraping.** Only the public `t.me/s/` web preview of channels that already publish it.

These are product decisions, not missing features. See [docs/ACCEPTABLE_USE.md](docs/ACCEPTABLE_USE.md).

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
| **Devices** | consent-gated position ingest, geofences with haversine distance, battery/accuracy telemetry |
| **Cameras** | own-asset register with AES-256-GCM encrypted endpoint + credentials, TCP/HTTP reachability check |
| **Admin** | operator management, credit grants, encrypted provider credentials, audit trail browser |
| **API** | `POST /api/v1/lookup` with bearer keys or session cookie; scoped key management |

---

## Quick start

### 1. Local development

```bash
git clone https://github.com/aryarifki/Hamsa.git
cd Hamsa
cp .env.example .env

# generate a real secret — required before production
openssl rand -base64 48   # paste into HAMSA_SECRET

npm install
npm run dev               # http://localhost:3000
```

On first boot Hamsa creates an administrator from `HAMSA_ADMIN_EMAIL` / `HAMSA_ADMIN_PASSWORD` and initialises the SQLite schema. Change that password from **Settings → Change password** immediately.

Optional demo data:

```bash
npm run seed   # analyst@hamsa.local / hamsa-demo-passphrase (250 credits)
```

### 2. Docker

```bash
cp .env.example .env      # set HAMSA_SECRET
docker compose up -d --build
```

The database lives in the `hamsa-data` volume at `/app/data/hamsa.db`.

### 3. Production notes

```bash
npm ci
npm run build
HAMSA_SECURE_COOKIES=true NODE_ENV=production npm start
```

Hamsa refuses to start in production if `HAMSA_SECRET` is missing or still the placeholder — otherwise provider keys and camera passwords would be encrypted with a publicly known key.

---

## Configuration

All settings are environment variables; none are required to boot except in production.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HAMSA_SECRET` | — | **Required in production.** Derives the AES-256-GCM key for secrets at rest |
| `HAMSA_DB_PATH` | `./data/hamsa.db` | SQLite file (`:memory:` supported for tests) |
| `HAMSA_ADMIN_EMAIL` | `admin@hamsa.local` | Bootstrap administrator |
| `HAMSA_ADMIN_PASSWORD` | `change-this-on-first-login` | Bootstrap password — rotate immediately |
| `HAMSA_SIGNUP_CREDITS` | `25` | Credits granted on registration |
| `HAMSA_COST_PHONE` / `_IP` / `_EMAIL` / `_USERNAME` / `_TELEGRAM` | `2/2/3/3/4` | Per-lookup pricing |
| `HAMSA_AUTH_RATE_LIMIT` | `10` | Login/register attempts per IP per minute |
| `HAMSA_SECURE_COOKIES` | `false` (auto in prod) | Force `Secure` on the session cookie |
| `HAMSA_ALLOW_FREE_PROVIDERS` | `true` | Set `false` to forbid keyless IP lookups (fully offline mode) |
| `IPINFO_TOKEN` | — | Preferred IP provider |
| `NUMVERIFY_KEY` | — | Carrier lookup provider |
| `HIBP_API_KEY` | — | Breach history |
| `CRON_SECRET` | — | Required by the watchlist scheduler endpoint |

Provider keys can also be set by an administrator in **Admin → Provider credentials**; a stored key overrides the environment.

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
  api/v1/            lookup, export, device ingest, cron, health
lib/
  db.ts              schema + typed node:sqlite helpers + transactions
  crypto.ts          scrypt, AES-256-GCM, tokens
  users/auth         credentials vs. request-scoped session (testable split)
  tokens.ts          credit ledger with an atomic overdraft guard
  lookup.ts          orchestration: charge → run → persist → refund on error
  intel/             phone, ip, email, username, telegram, cctv, geo
components/          design system + renderers (no UI framework dependency)
docs/                architecture, API, security, deployment, acceptable use
tests/               18 unit tests, no network, in-memory database
```

No ORM, no component library, no state manager, no chart library: the database layer is ~250 lines of `node:sqlite`, the design system is CSS custom properties plus a dozen utility classes, and the map/graph visuals are inline SVG. Fewer moving parts means fewer upgrade paths that break.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Testing

```bash
npm test        # 18 unit tests, in-memory SQLite, no network access
npm run typecheck
npm run build
```

Covered: password hashing and verification, AES-GCM tamper detection, haversine/geofence math, E.164 normalisation and carrier inference, IP classification, credit atomicity and overdraft refusal, ledger integrity, suspended-account lockout, pricing overrides.

---

## Security posture

- CSRF: server actions are same-origin by construction; the only JSON endpoint requires an `Authorization` header or the session cookie with `SameSite=Lax`.
- CSP is **enforced** (`script-src 'self'`), not report-only; framing denied; MIME sniffing disabled.
- Sessions are 256-bit random tokens stored as SHA-256 digests; revocation is server-side.
- Provider credentials and camera passwords are encrypted with AES-256-GCM derived from `HAMSA_SECRET`.
- Audit entries are written server-side only and are append-only by convention (no update/delete path exists in the code).
- Login always performs a hash comparison, so unknown accounts and wrong passwords take comparable time.

Threat model and known limitations: [docs/SECURITY.md](docs/SECURITY.md).

---

## Legal

Hamsa is an investigation tool. Using it against people without a lawful basis may be illegal in your jurisdiction, and the audit trail is designed to make that attributable. Read [docs/ACCEPTABLE_USE.md](docs/ACCEPTABLE_USE.md) before deploying.

This project is independent and unaffiliated with any commercial OSINT service. It contains no third-party proprietary code, assets or credentials.

## License

MIT © 2026 aryarifki — see [LICENSE](LICENSE).
