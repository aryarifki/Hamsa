# Architecture

Hamsa is a single-process Next.js application in front of PostgreSQL, with `ffmpeg` as the only external binary. No queue, no cache tier, no separate worker, no ORM. That constraint is deliberate — an OSINT console that needs five services to boot is a console nobody self-hosts.

```
Browser ──► Next.js App Router ──► lib/* ──► PostgreSQL 15+
                   │                  │
                   │                  ├──► provider HTTP (optional, keyed)
                   │                  ├──► public endpoints (keyless)
                   │                  └──► ffmpeg ──► RTSP/ONVIF camera (own assets)
                   └──► Server Actions / Route Handlers
```

## Layers

### Presentation — `app/`

| Route group | Responsibility |
| --- | --- |
| `app/(auth)` | Login and registration. Server Actions validate, throttle, hash, create the session, then `redirect()`. |
| `app/(console)` | Authenticated shell: sidebar, notifications badge, all operator screens. The layout calls `requireUser()`; every child inherits the guarantee. |
| `app/api/v1` | Machine surface: lookup, export, device ingest, camera snapshots, cron, health. |

Server Components read the database directly — there is no internal HTTP hop between a page and its data. Client Components exist only where interactivity is required: the lookup console, copy buttons, forms with `useActionState`, print.

### Domain — `lib/`

| Module | Responsibility | Notable invariant |
| --- | --- | --- |
| `db.ts` | Pool, typed `one/all/run`, `exec`, `tx()`, `withClient`, `?`→`$n` translation | One pool per process, cached on `globalThis` for HMR; timestamptz parsed back to ISO |
| `schema.ts` | v1 baseline DDL | New installs run the baseline then every migration |
| `migrations.ts` | Reversible migrations with data copy | Every `up` has a `down`; lossy steps declare `dataLoss` |
| `crypto.ts` | scrypt, AES-256-GCM, tokens | Secrets are never logged or returned unmasked |
| `users.ts` | Credentials and user records | Free of `next/*` imports so it is unit-testable |
| `auth.ts` | Session lifecycle, `requireUser`, `requireAdmin`, `requireOperator` | Cookie is httpOnly + SameSite=Lax; DB stores only a digest |
| `auth-phonex.ts` | Phone OTP, password login, `x-session-token` sessions | Codes are hashed, single-use, 5-minute TTL, 5 attempts; OTP-only accounts get a synthetic email |
| `tokens.ts` | Credit ledger | Debit is a conditional `UPDATE … WHERE credits >= ?` |
| `tokens-phonex.ts` | QRIS/USDT top-ups, plans, settlement | Settlement is a single guarded `UPDATE`; expiry is committed outside the tx |
| `qr-encode.ts` | QR encoder (`qrcode-generator`) | Pure function; returns inline SVG or null |
| `lookup.ts` | Orchestration | Charge → persist → dispatch → persist → audit; refund on throw |
| `audit.ts` | Append-only trail | Never throws into the request path |
| `notify.ts` | In-app inbox | Camera alerts go to admins; geofence notices to the owner |
| `rate-limit.ts` | Fixed-window limiter | In-process; swap for Redis when horizontally scaled |
| `cctv/ffmpeg.ts` | Spawn wrapper, input policy, failure classifier, redaction | No shell; timeouts; `file:` blocked in production |
| `cctv/mog2.ts` | Pure-TS MOG2 background subtractor | Fixed-size grayscale frames; erosion removes isolated noise |
| `cctv/onvif.ts` | SOAP PullPoint client with an injectable transport | WS-Security digest; PullPoint only |
| `cctv/service.ts` | Enrolment, checks, capture, fail-closed, cron pass, pruning | Credentials split from URL and encrypted; auth failure disables |
| `cctv/storage.ts` | Private snapshot paths | Path validated under the storage root before read/write |
| `cctv/public-feeds.ts` | 31-city public CCTV catalogue and frame capture | Streams come from `HAMSA_PUBLIC_CCTV_<SLUG>`; no portal scraping |
| `track/consent.ts` | Token mint/hash/revoke, ownership queries | Plaintext token is returned once; digest only at rest |
| `track/geofence.ts` | Haversine evaluation, transition state, location ingest | Previous transition is the latest event; no duplicates |
| `track/chain.ts` | Tango geofence chains and public reports | Codes are 8 chars from a 32-symbol alphabet; owner-scoped reads |
| `track/geofence-preview.ts` | EXIF GPS extraction from uploaded stills | Returns `found:false` instead of guessing; RATIONAL is 8 bytes |
| `intel/*` | One module per data domain | Each returns a uniform `ModuleResult` |
| `intel/preview.ts` | Polaris-X preview window | 5 minutes active, 35 minutes cooldown, in-memory per process |
| `intel/situational.ts` | Public feeds (BMKG, GDACS, OpenSky, Celestrak, FIRMS, RSS) | Every fetch is bounded by a timeout and reports its source |

Every intelligence module returns the same shape:

```ts
{ module, target, durationMs, sources[], signals[], data{}, warnings? }
```

That is what makes one generic renderer (`components/DataView.tsx`) enough for fifteen very different payloads, and why adding a module does not require touching the UI.

### Data — PostgreSQL

One connection pool, parameterised SQL, `timestamptz` everywhere. The schema is applied on boot under a session-level advisory lock (`741852963`), so several Next workers cannot race through the migration table.

| Table | Purpose |
| --- | --- |
| `users`, `sessions` | Identity and server-side sessions |
| `ledger` | Every credit movement with running balance |
| `lookups` | One row per query: target, status, cost, payload, duration |
| `cases`, `case_items` | Dossiers and the evidence attached to them |
| `audit_log` | Actor, action, entity, IP, user agent, timestamp |
| `api_keys` | Prefix for display, SHA-256 digest for verification |
| `providers` | Admin-managed credentials, AES-GCM encrypted |
| `watchlist` | Scheduled re-runs and their last outcome |
| `tracked_devices` | Consent device, owner, token digest, consent reference, revocation, last fix |
| `device_locations` | Append-only position history (`lat`, `lon`, `ts`, `accuracy`, `battery`) |
| `geofences` | Device-scoped or org-wide (`device_id IS NULL`) circles |
| `geofence_events` | `enter` / `exit` transitions, one per real crossing |
| `cameras` | Own-asset stream, ONVIF host, encrypted credentials, interval, motion threshold, status |
| `camera_snapshots` | Snapshot path, bytes, motion ratio, capture time |
| `camera_events` | Motion events from MOG2 (`mog2`) or ONVIF (`onvif`) |
| `notifications` | Per-user inbox rows (camera alerts, geofence transitions) |
| `schema_migrations` | Applied migration ids and timestamps |
| `settings` | Reserved key/value store |

The baseline `SCHEMA` stays at the v1 shape. Every later change is a migration, which is what makes upgrades and rollbacks testable.

## Request flows

### Interactive lookup

1. Client posts JSON to `/api/v1/lookup`.
2. `authenticate()` resolves either the session cookie or an `hk_…` bearer key.
3. `enforceRate()` applies a 60/min bucket keyed by user or API key.
4. `runLookup()` charges credits atomically, inserts a `queued` row, dispatches.
5. On success: payload, provider list and duration are written; an audit entry is appended.
6. On failure: credits are refunded, the row is marked `error`, the client gets 502 with the reason.

### Server Action mutation

Forms post to a Server Action. The action re-derives the user from the session (never from form data), validates, mutates inside a transaction where needed, writes an audit entry, then `revalidatePath()`. Camera and tracking actions additionally call `requireOperator()`.

### Device location ingest

`POST /api/v1/device/ping` (alias `/api/v1/track/location`) with `Authorization: Bearer <consent-token>`:

1. `rateLimit()` allows 60 updates/minute per token digest.
2. `recordLocation()` hashes the token, looks up `tracked_devices` with `revoked_at IS NULL`, and throws `TrackForbiddenError` on no match (route returns a uniform 403).
3. The position is appended to `device_locations` and the denormalised `last_*` columns are updated.
4. `evaluateGeofences()` selects device-scoped + org-wide fences, computes haversine distances, reads the latest event per fence, and inserts only real transitions.
5. Transitions notify the owner and append `geofence.enter` / `geofence.exit` audit entries.

The device can only write its own position. There is no read endpoint that accepts a phone number.

### Camera schedule

`POST /api/v1/cron/cameras` with `x-cron-secret` (or Bearer):

1. Select up to `HAMSA_CAMERA_BATCH` cameras whose `last_snapshot_at + interval` has elapsed, excluding `disabled_auth`/`needs_config`.
2. `captureCamera()` decrypts credentials, probes the stream, and writes a JPEG to `storage/cameras/<id>/<iso>.jpg`.
3. It then grabs 12 grayscale 320×240 frames, runs MOG2, and stores the last foreground ratio. A ratio at or above the camera threshold records a `mog2` event.
4. If the camera has an ONVIF host, `pollCameraEvents()` creates/reuses a PullPoint subscription and stores motion notifications as `onvif` events.
5. A 401/403 classifies as authentication failure: status becomes `disabled_auth`, admins are notified, an audit entry is written, and the camera is skipped by every later pass until an operator re-enables it.
6. The pass prunes snapshot rows and files older than `HAMSA_SNAPSHOT_RETENTION_DAYS`.

### Snapshot read

`GET /api/v1/cctv/snapshot/[id]`:

1. Authenticate a user session or API key.
2. Load the snapshot, then require `cameraForUser(snapshot.camera_id, user)`.
3. Resolve `file_path` and verify it is inside `HAMSA_STORAGE_DIR`.
4. Stream the bytes with `image/jpeg`, private cache and `nosniff`.

### Migrations

`ensureSchema()` runs the baseline `SCHEMA` (`CREATE TABLE/INDEX IF NOT EXISTS`) and then `applyMigrations()`, each inside a transaction. `npm run migrate down` reverses one migration, restoring the previous tables and copying rows back. Lossy steps are declared in `dataLoss` and printed by the CLI.

## Trade-offs

| Decision | Why | Cost |
| --- | --- | --- |
| Raw SQL + `pg` over an ORM | Zero codegen, schema is readable, migrations are explicit | Hand-written SQL; no typed query builder |
| `?` placeholders translated to `$n` | Keeps call sites compact and reviewable across the port | The Postgres `?` JSON operator cannot be used in raw SQL |
| Server Components reading the DB directly | Fewer hops, no API surface to secure | Pages are inherently dynamic |
| In-process rate limiting | Works with one `docker run` | Not shared across replicas |
| Pure-TS MOG2 | No OpenCV/native build; runs inside the cron request | Simpler than OpenCV's full model, tuned for short bursts |
| Hand-rolled ONVIF PullPoint | Avoids a large SOAP dependency | PullPoint only; no push subscriptions |
| ffmpeg subprocess | Handles every codec and RTSP variant | One more binary to install; resource use must be bounded |
| Provider adapters optional | Boots and works with no keys | Some fields stay `null` until configured |
| Print-to-PDF instead of a PDF library | No 40 MB dependency, output is the operator's own renderer | Requires a browser print dialog |
| Generic JSON renderer | One component for five modules | Less bespoke presentation per module |

## Extension points

- **New module:** add `lib/intel/<name>.ts` returning `ModuleResult`, register the key in `ModuleKey` (`lib/tokens.ts`), add a case in `lookup.ts` dispatcher, and a page that renders `<LookupConsole module="…">`.
- **New provider:** add a query function in the module and read its key through `providerSecret("ENV_NAME")`.
- **New schema change:** append to `MIGRATIONS` in `lib/migrations.ts` with a reversible `down`, then extend `tests/migrations.test.mjs`.
- **Another camera transport:** implement a runner with the same `(args, options) => Promise<RunResult>` contract and inject it into `captureCamera`/`probeStream`; nothing else needs to know.
- **Horizontal scale:** replace `lib/rate-limit.ts` with Redis, run the camera cron on one replica (or add an advisory lock), and put snapshot storage on a shared volume or object store.
