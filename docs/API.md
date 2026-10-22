# API reference

Base URL: `https://your-host`. All responses are JSON unless noted. `Cache-Control: no-store` is set everywhere.

## Authentication

Two mechanisms, both accepted by the lookup and export endpoints:

1. **Session cookie** — `hamsa_session`, issued by the login Server Action. httpOnly, SameSite=Lax, 12-hour TTL, revoked server-side on logout.
2. **API key** — `Authorization: Bearer hk_<prefix>_<secret>`. Created in **Settings → API keys**; the plaintext is shown once and stored as a SHA-256 digest.

```http
Authorization: Bearer hk_ab12cd34_Xy9...
```

Missing or invalid credentials return `401 {"error":"Authentication required"}`.

## Rate limits

| Scope | Limit |
| --- | --- |
| Login / register | `HAMSA_AUTH_RATE_LIMIT` per IP per minute (default 10) |
| Lookups | 60 per minute per user or API key |
| Device pings | 120 per minute per device |
| Watchlist cron | shared `CRON_SECRET` |

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

Consent-gated position ingest.

```http
Authorization: Bearer dv_<token>
Content-Type: application/json

{ "lat": -6.2005, "lng": 106.8005, "accuracy": 8, "battery": 77 }
```

**Response `200`**

```json
{
  "receivedAt": "2026-10-22T07:12:23.659Z",
  "fences": [{ "id": "5cbc…", "name": "HQ", "inside": true, "distanceMeters": 78 }]
}
```

`401` for unknown/revoked tokens, `400` for out-of-range coordinates, `429` above 120 pings/minute.

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
| `/tracking` | Devices and geofences |
| `/cctv` | Own-asset camera register |
| `/billing` | Ledger and price list |
| `/settings` | Password, API keys, sessions |
| `/admin` | Operators, providers, audit trail |
