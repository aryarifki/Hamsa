# API reference

Base URL: `https://your-host`. All responses are JSON unless noted. `Cache-Control: no-store` is set everywhere except snapshots (private, short cache).

## Authentication

Three mechanisms, each scoped to its own surface:

1. **Session cookie** — `hamsa_session`, issued by the login Server Action. httpOnly, SameSite=Lax, 12-hour TTL, revoked server-side on logout.
2. **API key** — `Authorization: Bearer hk_<prefix>_<secret>`. Created in **Settings → API keys**; the plaintext is shown once and stored as a SHA-256 digest. Accepted by the lookup, export and snapshot endpoints.
3. **Consent token** — `Authorization: Bearer <uuid>`. Minted once when a device is enrolled in **Tracking**; only its SHA-256 digest is stored. Accepted by the device ingest endpoint only.

```http
Authorization: Bearer hk_ab12cd34_Xy9...
```

Missing or invalid user credentials return `401 {"error":"Authentication required"}`. A missing, unknown or revoked device token always returns `403 {"error":"Forbidden"}` — the ingest endpoint never confirms whether a device exists.

## Rate limits

| Scope | Limit |
| --- | --- |
| Login / register | `HAMSA_AUTH_RATE_LIMIT` per IP per minute (default 10) |
| Lookups | 60 per minute per user or API key |
| Device location updates | 60 per minute per token |
| Watchlist cron | shared `CRON_SECRET` |
| Camera cron | shared `CRON_SECRET` |

Exceeding a limit returns `429` with `retryAfter` (seconds) where available.

---

## `POST /api/v1/lookup`

Runs one intelligence module, charges credits, stores the result.

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `module` | `phone \| ip \| email \| username \| telegram` | yes | |
| `target` | string, 1–320 chars | yes | Format depends on module |
| `keyword` | string, ≤120 | no | Telegram only |
| `caseId` | string or null | no | Must belong to the caller; attaches the lookup as evidence |

**Response `201`**

```json
{
  "lookupId": "3eb145b7-8dac-4206-a9a2-5b1692da26b5",
  "module": "phone",
  "target": "+6281234567890",
  "cost": 2,
  "balance": 248,
  "durationMs": 14,
  "result": {
    "module": "phone",
    "target": "+6281234567890",
    "durationMs": 14,
    "sources": [{ "name": "libphonenumber (offline metadata)", "kind": "offline" }],
    "signals": [{ "label": "Number passes E.164 validation", "level": "info" }],
    "data": {
      "valid": true,
      "e164": "+6281234567890",
      "country": "ID",
      "countryName": "Indonesia",
      "type": "MOBILE",
      "typeLabel": "Mobile",
      "carrier": "Telkomsel",
      "carrierSource": "offline-prefix"
    }
  }
}
```

**Errors**

| Status | Body | Cause |
| --- | --- | --- |
| `400` | `{"error":"Invalid request body","issues":[…]}` | Schema validation |
| `401` | `{"error":"Authentication required"}` | No/invalid credentials |
| `402` | `{"error":"Insufficient credits","required":2,"balance":0}` | Balance guard |
| `403` | `{"error":"Viewer accounts cannot run lookups"}` | Role restriction |
| `404` | `{"error":"Case not found"}` | `caseId` not owned by caller |
| `429` | `{"error":"Too many requests","retryAfter":12}` | Rate limit |
| `502` | `{"error":"Lookup failed and was refunded: …"}` | Provider failure (credits returned) |

### Module payloads

**Phone** — `e164`, `national`, `international`, `rfc3966`, `country`, `callingCode`, `type`, `carrier`, `carrierSource`, `investigationLinks[]`.

**IP** — `version`, `scope` (`public|private|loopback|link-local|reserved|invalid`), `country`, `region`, `city`, `latitude`, `longitude`, `timezone`, `asn`, `org`, `isp`, `reverseDns`, `proxy`, `hosting`, `mobile`, `provider`.

**Email** — `normalized`, `validSyntax`, `domain`, `mxRecords[]`, `hasMx`, `disposable`, `roleAccount`, `gravatarUrl`, `gravatarExists`, `breaches[] | null`.

**Username** — `username`, `checked`, `foundCount`, `absentCount`, `unknownCount`, `hits[]` (`site`, `url`, `status`, `found`, `reliability`).

**Telegram** — `channel`, `keyword`, `count`, `posts[]` (`id`, `url`, `datetime`, `text`).

---

## `GET /api/v1/export/[id]`

Downloads a stored lookup.

| Query | Result |
| --- | --- |
| `format=json` (default) | Full record + parsed payload, `application/json`, attachment |
| `format=md` | Rendered Markdown dossier, `text/markdown`, attachment |

Requires the same authentication as lookup; only the owner's records are visible. Generates an `export.generate` audit entry.

Print-to-PDF is a page, not an API: `GET /history/<id>/print`.

---

## `POST /api/v1/device/ping`

Consent-gated position ingest. `/api/v1/track/location` is an alias of the same handler.

```http
Authorization: Bearer <consent-token>
Content-Type: application/json

{ "lat": -6.2005, "lon": 106.8005, "accuracy": 8, "battery": 77 }
```

`lng` is accepted as an alias for `lon` (older clients). `ts` may be an ISO-8601 timestamp; otherwise the server time is used.

**Response `200`**

```json
{
  "receivedAt": "2026-10-22T07:12:23.659Z",
  "device": { "id": "9f0a…", "name": "Field kit" },
  "fences": [
    { "id": "5cbc…", "name": "HQ", "inside": true, "distanceMeters": 78 }
  ],
  "transitions": [
    { "geofenceId": "5cbc…", "name": "HQ", "type": "enter", "distanceMeters": 78 }
  ]
}
```

`transitions` is empty when the update did not cross a boundary. The first position inside a fence produces `enter`; an inside-to-outside update produces `exit`; repeats are suppressed.

**Errors**

| Status | Body | Cause |
| --- | --- | --- |
| `400` | `{"error":"Invalid location payload"}` | Missing/out-of-range `lat`/`lon`, bad timestamp |
| `403` | `{"error":"Forbidden"}` | Missing, unknown or revoked token (no detail, by design) |
| `429` | `{"error":"Too many location updates","retryAfter":12}` | More than 60 updates/minute for the token |

---

## `GET /api/v1/cctv/snapshot/[id]`

Returns the JPEG for one snapshot. Requires a session cookie or an API key; the caller must own the camera or be an administrator. The database path is validated against `HAMSA_STORAGE_DIR` before the file is read.

| Status | Meaning |
| --- | --- |
| `200` | `image/jpeg`, `Cache-Control: private, max-age=60` |
| `401` | No user authentication |
| `404` | Snapshot does not exist, caller does not own it, or the file is missing |

---

## `POST /api/v1/cron/watchlist`

Runs due watchlist entries (max 10 per call).

```http
x-cron-secret: $CRON_SECRET
```

```json
{
  "checked": 3,
  "skipped": 0,
  "errors": 0,
  "results": [{ "id": "60f6…", "target": "+628111112222", "status": "ok" }]
}
```

`503` when `CRON_SECRET` is unset; `401` on a bad secret. Entries whose owner lacks credits are skipped, never overdrawn.

---

## `POST /api/v1/cron/cameras`

Runs one bounded camera pass, then prunes snapshots older than `HAMSA_SNAPSHOT_RETENTION_DAYS`.

```http
x-cron-secret: $CRON_SECRET
```

```json
{
  "checked": 2,
  "captured": 2,
  "motion": 1,
  "onvifEvents": 0,
  "errors": 0,
  "pruned": 4,
  "results": [
    { "id": "0f2c…", "name": "Gate", "captured": true, "motion": false }
  ]
}
```

Cameras in `disabled_auth` or `needs_config` are skipped until an operator fixes and re-enables them. Only cameras whose interval has elapsed are selected, up to `HAMSA_CAMERA_BATCH` (max 25).

---

## `GET /api/health`

Unauthenticated liveness probe. Returns `{"status":"ok","database":"reachable","time":"…"}` or `503`.

---

## Web UI routes

| Path | Purpose |
| --- | --- |
| `/` | Dashboard: balance, activity sparkline, module mix |
| `/lookup/{phone,ip,email,username,telegram}` | Interactive console |
| `/cases`, `/cases/[id]` | Dossiers and evidence |
| `/history`, `/history/[id]`, `/history/[id]/print` | Records and exports |
| `/watchlist` | Scheduled monitoring |
| `/tracking` | Consent devices, tokens and geofences |
| `/cctv` | Own-asset camera monitor |
| `/notifications` | Camera alerts and geofence transitions |
| `/billing` | Ledger and price list |
| `/settings` | Password, API keys, sessions |
| `/admin` | Operators, providers, audit trail |
