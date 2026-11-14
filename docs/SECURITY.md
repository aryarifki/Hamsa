# Security

Hamsa stores investigation records, provider credentials, consent references, camera snapshots and location history. Treat a deployment as you would treat a case file cabinet: the application provides the locks, but the operator decides who gets a key.

## Threat model

| Asset | Adversary | Control |
| --- | --- | --- |
| Session cookies | Network attacker, XSS | httpOnly, SameSite=Lax, `Secure` in production, SHA-256 digest stored server-side, server-side revocation |
| Passwords | Offline dump of the database | scrypt (N=16384, r=8, p=1, 64-byte output, 16-byte salt) |
| Provider API keys, camera credentials | Database dump, backup leak | AES-256-GCM with a key derived from `HAMSA_SECRET` via scrypt; never rendered back to the client |
| Camera snapshots | Cross-tenant access, path traversal | Owner-scoped API route, path validated against the storage root, private directory outside `public/` |
| Location history | Cross-tenant access, unauthorised tracking | Consent token required, SHA-256 digest at rest, revocable, uniform 403 for invalid/revoked tokens |
| Lookup records | Cross-tenant access | Every query is scoped by `user_id` at the SQL level; no page or API accepts an arbitrary record id without that clause |
| Evidence integrity | Operator tampering | Append-only audit log with actor, IP, user agent, entity and timestamp |
| API keys | Credential stuffing, leak | 32-byte random tokens, only a SHA-256 digest at rest, display prefix only, revocable |
| Abuse of the lookup engine | A compromised account burning credits or targeting a third party | Per-user rate limits, credit balance guard, mandatory authorization reference on cases |

### Trust boundaries

Hamsa secures the application layer. The deployment provides the rest, and the split is
worth knowing before an incident:

- **Host and database.** Whoever holds root on the box can read the PostgreSQL data
  directory, the process environment and the snapshot volume. Run Hamsa on a host you
  control, with disk encryption and a database role that cannot reach anything else.
- **Network.** Put a TLS terminator in front (the app binds `127.0.0.1` in Compose) and
  restrict PostgreSQL to the app host. `HAMSA_TRUSTED_PROXY` must only list proxies that
  actually overwrite `X-Forwarded-For`.
- **Upstream feeds.** Provider answers are recorded with the provider name and timestamp so
  a bad upstream response is attributable. `ffmpeg` and any provider client run with the
  app's privileges.
- **Cameras and ONVIF devices.** Hamsa consumes what the device sends; the device's own
  firmware, credentials and network segment are the operator's responsibility.
- **Availability.** The in-process limiter and the bounded scheduler batch protect against
  accidental load. Deliberate flooding is absorbed in front of the app (reverse proxy,
  CDN, or Cloudflare Turnstile via `HAMSA_TURNSTILE_SECRET` for the OTP endpoints).

## Controls in detail

### Passwords

`lib/crypto.ts` uses `scryptSync` with a per-password random salt and stores `scrypt$N$r$p$salt$hash`. Verification is constant-time via `timingSafeEqual`. `checkCredentials()` deliberately performs a hash comparison even when the email is unknown, so account enumeration by timing does not work. Login and registration are additionally rate-limited per IP.

### Sessions

A login mints 32 random bytes, sets them as `hamsa_session`, and stores `sha256(token)` in `sessions` with a 12-hour expiry, the client IP and the user agent. Logout sets `revoked_at`. Changing a password revokes every other session for that account. Expired rows are ignored on read; a periodic `DELETE FROM sessions WHERE expires_at < now()` is safe to run from cron.

### Secrets at rest

`encryptSecret()` produces `v1.<iv>.<tag>.<ciphertext>` (base64url, AES-256-GCM). The key is `scrypt(HAMSA_SECRET, "hamsa:aead:v1", 32)`. A tampered ciphertext fails authentication and throws rather than returning garbage.

In production, `bootstrap()` refuses to start when `HAMSA_SECRET` is missing or still the placeholder. This is intentional: a known key is worse than a failed boot.

Camera URLs are sanitised before storage: the username and password are removed from `rtsp_url` and stored in separate `username_enc` / `password_enc` columns. ffmpeg receives the credentials in the URL argument at runtime, never through a shell, and stderr is redacted (`rtsp://***@…`) before it is written to `last_error` or an audit entry.

### Consent tokens

Enrolment mints a random UUID. The database stores only `sha256(token)`; the plaintext is returned once to the operator. `findDeviceByToken()` filters `revoked_at IS NULL`, so revocation is immediate and indistinguishable from a forged token at the API boundary. The endpoint returns the same `403 {"error":"Forbidden"}` for missing, malformed, unknown and revoked tokens, and is limited to 60 updates/minute/token.

Registration writes two audit entries (`device.create`, `device.consent`), and revocation writes `device.revoke`. The consent reference is mandatory and appears on the device in the UI.

### Authorisation

- `requireUser()` redirects unauthenticated visitors to `/login`.
- `requireAdmin()` redirects non-admins to `/`.
- `requireOperator()` (admin or analyst) guards the camera and tracking pages, actions and APIs.
- `viewer` accounts cannot run lookups (`403`) or mutate data.
- Every Server Action re-derives the user from the session cookie. Form fields never carry an actor identity.
- Row-level ownership (`WHERE user_id = ?` / `created_by = ?`) is applied on read *and* write. A guessed UUID does not grant access.
- Snapshots are served by `GET /api/v1/cctv/snapshot/[id]`, which authenticates the user, checks `cameraForUser()`, and only then reads the file. The path is resolved and compared with `HAMSA_STORAGE_DIR` to prevent traversal from a tampered row.

### CSRF

Server Actions are POST-only and same-origin by construction; Next.js validates the action id and the request origin. The JSON API requires an `Authorization: Bearer` header, which a cross-site form cannot set. The session cookie is `SameSite=Lax`, so it is not sent on cross-site POSTs.

### Content security

`next.config.ts` sets an enforced policy (not report-only):

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';
form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:;
style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'
```

Plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` denying camera/microphone/geolocation to the page itself, `Cross-Origin-Opener-Policy: same-origin` and HSTS.

`'unsafe-inline'` is required for the inline bootstrap script Next.js emits for hydration and for the inline styles used by the design system. If you inject third-party scripts, add them explicitly rather than loosening `script-src`.

### SSRF surface

The outbound requests with operator-controlled input are:

- Username sweep — target hostnames come from a hard-coded allow-list of 22 sites.
- Telegram — host is fixed (`t.me`), the channel is validated against `^[A-Za-z0-9_]{4,64}$`.
- Email — MX lookup only (DNS).
- IP — fixed provider hosts.
- Camera probe/capture — the RTSP/HTTP endpoint *is* operator-supplied, so this is a deliberate SSRF primitive by design. ffmpeg is spawned without a shell, input is limited to `rtsp`, `rtsps`, `http`, `https` and (in development) `file:`, and each operation has a timeout. It is available to authenticated operators only.
- ONVIF — SOAP requests go to the operator-supplied host, with optional WS-Security UsernameToken. Only PullPoint is implemented.

If you need to harden further, add a private-IP allow/deny policy for camera enrolment (many deployments *must* reach RFC1918 cameras, so it cannot be denied unconditionally).

### SQL injection

All queries are parameterised. `lib/db.ts` rewrites `?` placeholders to `$1..$n` with a quote-aware scanner; values are always passed as parameters. The only string interpolation into SQL is fixed table/column constants and the `USER_COLUMNS` list. JSON payload columns are cast with `::jsonb` where queried, and JSON paths are literals.

### Logging

`lib/audit.ts` writes actor, action, entity, IP (from `cf-connecting-ip` / `x-real-ip` / `x-forwarded-for`), user agent and metadata. It swallows its own errors so a failed audit write cannot take down a request — which means a failed database write silently loses entries; monitor PostgreSQL availability and `audit_log` growth.

Secrets are never logged: provider errors are truncated to 120 characters when written to `watchlist.last_status`, camera stderr is truncated and URL-redacted, and payloads are not echoed to the console. Session and consent tokens appear in no table in plaintext.

## Hardening checklist for production

- [ ] `HAMSA_SECRET` is 48+ random bytes, stored in a secret manager, backed up separately from the database.
- [ ] `HAMSA_ADMIN_PASSWORD` was changed through the UI after first login.
- [ ] PostgreSQL requires a password, listens only on loopback/private networking, and uses TLS if the database is remote.
- [ ] Cookies are `Secure` (`HAMSA_SECURE_COOKIES=true` behind TLS).
- [ ] The app is behind a reverse proxy that terminates TLS and sets `X-Forwarded-For`.
- [ ] `HAMSA_STORAGE_DIR` is mode `700`, owned by the app user, outside `public/`, and not exposed by the proxy.
- [ ] Backups (database + storage) are encrypted and tested by restoring into a scratch environment.
- [ ] `CRON_SECRET` is random and the cron endpoints are not publicly documented.
- [ ] Provider keys are scoped to the minimum product and rotated on a schedule.
- [ ] Log retention and snapshot retention match the legal basis recorded in your cases.
- [ ] Device tokens are revoked and camera schedules disabled when an engagement ends.

## Known limitations

1. **In-process rate limiting.** Fine for a single instance; a multi-replica deployment needs a shared store (Redis) or the limiter becomes per-replica.
2. **One camera scheduler pass at a time.** There is no cross-replica lock around `/api/v1/cron/cameras`; run it against one replica.
3. **No MFA.** The role model and session revocation are the only account-takeover defences beyond the password. Add TOTP before exposing this to the open internet.
4. **Print-to-PDF depends on the browser.** There is no server-side renderer, so the export reflects the operator's print settings.
5. **Audit log is append-only by convention**, not by database trigger. A database superuser can rewrite it. Ship the log to an external sink if you need non-repudiation.
6. **Camera capture is SSRF-capable by design.** Restrict enrolment to trusted operators and keep the service off untrusted networks.
7. **Snapshots are unencrypted at rest.** They are JPEGs on the storage volume; rely on disk/volume encryption and filesystem permissions.
8. **ONVIF PullPoint only.** Push-only cameras are not supported; use RTSP + MOG2 for those.
9. **`file://` inputs** are rejected in production unless `HAMSA_CCTV_ALLOW_LOCAL_MEDIA=true`; enable it only for a disposable demo.

## Reporting a vulnerability

Open a private security advisory on the repository rather than a public issue. Include reproduction steps, the affected version and the impact you believe it has. Expect an acknowledgement within a few days.
