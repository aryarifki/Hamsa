# Architecture

Hamsa is a single-process Next.js application: one Node server, one SQLite file, no queue, no cache tier, no separate worker. That constraint is deliberate — an OSINT console that needs five services to boot is a console nobody self-hosts.

```
Browser ──► Next.js App Router ──► lib/* ──► node:sqlite (WAL)
                   │                  │
                   │                  ├──► provider HTTP (optional, keyed)
                   │                  └──► public endpoints (keyless)
                   └──► Server Actions / Route Handlers
```

## Layers

### Presentation — `app/`

| Route group | Responsibility |
| --- | --- |
| `app/(auth)` | Login and registration. Server Actions validate, throttle, hash, create the session, then `redirect()`. |
| `app/(console)` | Authenticated shell: sidebar, top bar, all operator screens. The layout calls `requireUser()`; every child inherits the guarantee. |
| `app/api/v1` | Machine surface: lookup, export, device ingest, cron, health. |

Server Components read the database directly — there is no internal HTTP hop between a page and its data. Client Components exist only where interactivity is required: the lookup console, copy buttons, forms with `useActionState`, print.

### Domain — `lib/`

| Module | Responsibility | Notable invariant |
| --- | --- | --- |
| `db.ts` | Schema bootstrap, typed `one/all/run`, `tx()` | One connection per process, cached on `globalThis` for HMR |
| `crypto.ts` | scrypt, AES-256-GCM, tokens | Secrets are never logged or returned unmasked |
| `users.ts` | Credentials and user records | Free of `next/*` imports so it is unit-testable |
| `auth.ts` | Session lifecycle, `requireUser`, `requireAdmin` | Cookie is httpOnly + SameSite=Lax; DB stores only a digest |
| `tokens.ts` | Credit ledger | Debit is a conditional `UPDATE … WHERE credits >= ?` |
| `lookup.ts` | Orchestration | Charge → persist → dispatch → persist → audit; refund on throw |
| `audit.ts` | Append-only trail | Never throws into the request path |
| `rate-limit.ts` | Fixed-window limiter | In-process; swap for Redis when horizontally scaled |
| `intel/*` | One module per data domain | Each returns a uniform `ModuleResult` |

Every intelligence module returns the same shape:

```ts
{ module, target, durationMs, sources[], signals[], data{}, warnings? }
```

That is what makes one generic renderer (`components/DataView.tsx`) enough for five very different payloads, and why adding a module does not require touching the UI.

### Data — SQLite

WAL mode, foreign keys on, 5 s busy timeout. One file, backed up by copying it (with `VACUUM INTO` for a consistent snapshot).

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
| `devices`, `geofences`, `device_pings` | Consent-based position reporting |
| `cctv_assets` | Own-asset stream register |
| `settings` | Reserved key/value store |

## Request flows

### Interactive lookup

1. Client posts JSON to `/api/v1/lookup`.
2. `authenticate()` resolves either the session cookie or an `hk_…` bearer key.
3. `enforceRate()` applies a 60/min bucket keyed by user or API key.
4. `runLookup()` charges credits atomically, inserts a `queued` row, dispatches.
5. On success: payload, provider list and duration are written; an audit entry is appended.
6. On failure: credits are refunded, the row is marked `error`, the client gets 502 with the reason.

### Server Action mutation

Forms post to a Server Action. The action re-derives the user from the session (never from form data), validates, mutates inside a transaction where needed, writes an audit entry, then `revalidatePath()`.

### Device ping

`POST /api/v1/device/ping` with `Authorization: Bearer dv_…`:

1. Token digest lookup → device row (revoked devices fail closed).
2. 120 pings/min per device.
3. Insert ping, update denormalised `last_*` columns on the device.
4. Evaluate every fence with haversine and return `{ inside, distanceMeters }` per fence.

The device can only write its own position. There is no read endpoint that accepts a phone number.

### Watchlist cron

`POST /api/v1/cron/watchlist` with `x-cron-secret`:

- Selects up to 10 entries whose `last_run_at + interval_hours <= now`.
- Skips owners who cannot afford the lookup (never overdrafts).
- Stores the lookup id and signals for later diffing.

## Trade-offs

| Decision | Why | Cost |
| --- | --- | --- |
| `node:sqlite` over an ORM | Zero native build, zero migration tool, schema is one readable string | Hand-written SQL; no typed query builder |
| Server Components reading the DB directly | Fewer hops, no API surface to secure | Pages are inherently dynamic |
| In-process rate limiting | Works with one `docker run` | Not shared across replicas |
| Provider adapters optional | Boots and works with no keys | Some fields stay `null` until configured |
| Print-to-PDF instead of a PDF library | No 40 MB dependency, output is the operator's own renderer | Requires a browser print dialog |
| Generic JSON renderer | One component for five modules | Less bespoke presentation per module |

## Extension points

- **New module:** add `lib/intel/<name>.ts` returning `ModuleResult`, register the key in `ModuleKey` (`lib/tokens.ts`), add a case in `lookup.ts` dispatcher, and a page that renders `<LookupConsole module="…">`.
- **New provider:** add a query function in the module and read its key through `providerSecret("ENV_NAME")`.
- **Horizontal scale:** replace `lib/rate-limit.ts` with Redis and move SQLite to Postgres; the rest of the code is storage-agnostic apart from `lib/db.ts`.
