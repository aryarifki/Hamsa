# Security

Hamsa stores investigation records, provider credentials and consent references. Treat a deployment as you would treat a case file cabinet: the application provides the locks, but the operator decides who gets a key.

## Threat model

| Asset | Adversary | Control |
| --- | --- | --- |
| Session cookies | Network attacker, XSS | httpOnly, SameSite=Lax, `Secure` in production, SHA-256 digest stored server-side, server-side revocation |
| Passwords | Offline dump of the database | scrypt (N=16384, r=8, p=1, 64-byte output, 16-byte salt) |
| Provider API keys, camera credentials | Database dump, backup leak | AES-256-GCM with a key derived from `HAMSA_SECRET` via scrypt; never rendered back to the client |
| Lookup records | Cross-tenant access | Every query is scoped by `user_id` at the SQL level; no page or API accepts an arbitrary record id without that clause |
| Evidence integrity | Operator tampering | Append-only audit log with actor, IP, user agent, entity and timestamp |
| API keys | Credential stuffing, leak | 32-byte random tokens, only a SHA-256 digest at rest, display prefix only, revocable |
| Abuse of the lookup engine | A compromised account burning credits or targeting a third party | Per-user rate limits, credit balance guard, mandatory authorization reference on cases |

### Explicitly out of scope

- A malicious server administrator. Someone with root can read the SQLite file, the environment and process memory.
- Physical access to the host.
- Compromise of an upstream provider (ipinfo, HIBP, Numverify). Hamsa records which provider answered and when.
- Denial of service beyond the in-process limiter.

## Controls in detail

### Passwords

`lib/crypto.ts` uses `scryptSync` with a per-password random salt and stores `scrypt$N$r$p$salt$hash`. Verification is constant-time via `timingSafeEqual`. `checkCredentials()` deliberately performs a hash comparison even when the email is unknown, so account enumeration by timing does not work. Login and registration are additionally rate-limited per IP.

### Sessions

A login mints 32 random bytes, sets them as `hamsa_session`, and stores `sha256(token)` in `sessions` with a 12-hour expiry, the client IP and the user agent. Logout sets `revoked_at`. Changing a password revokes every other session for that account. Expired rows are ignored on read; a periodic `DELETE FROM sessions WHERE expires_at < …` is safe to run from cron.

### Secrets at rest

`encryptSecret()` produces `v1.<iv>.<tag>.<ciphertext>` (base64url, AES-256-GCM). The key is `scrypt(HAMSA_SECRET, "hamsa:aead:v1", 32)`. A tampered ciphertext fails authentication and throws rather than returning garbage.

In production, `bootstrap()` refuses to start when `HAMSA_SECRET` is missing or still the placeholder. This is intentional: a known key is worse than a failed boot.

### Authorisation

- `requireUser()` redirects unauthenticated visitors to `/login`.
- `requireAdmin()` redirects non-admins to `/`.
- `viewer` accounts cannot run lookups (`403`) or mutate data.
- Every Server Action re-derives the user from the session cookie. Form fields never carry an actor identity.
- Row-level ownership (`WHERE user_id = ?`) is applied on read *and* write. A guessed UUID does not grant access.

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

The only outbound requests with operator-controlled input are:

- Username sweep — target hostnames come from a hard-coded allow-list of 22 sites.
- Telegram — host is fixed (`t.me`), the channel is validated against `^[A-Za-z0-9_]{4,64}$`.
- Email — MX lookup only (DNS).
- IP — fixed provider hosts.
- Camera check — the endpoint *is* operator-supplied, so this is a deliberate SSRF primitive by design. It is restricted to `rtsp`, `rtsps`, `http` and `https`, resolves and connects with a 3-second timeout, and is available to authenticated operators only. **Do not expose camera enrolment to untrusted users.**

If you need to harden further, add a private-IP block in `probeCctv()`.

### SQL injection

All queries are parameterised. The only string interpolation into SQL is the `USER_COLUMNS` constant and `?` placeholder counts, both compile-time constants. `json_extract` paths are literal.

### Logging

`lib/audit.ts` writes actor, action, entity, IP (from `cf-connecting-ip` / `x-real-ip` / `x-forwarded-for`), user agent and metadata. It swallows its own errors so a failed audit write cannot take down a request — which means a full disk silently loses entries; monitor `data/` capacity.

Secrets are never logged: provider errors are truncated to 120 characters when written to `watchlist.last_status`, and payloads are not echoed to the console.

## Hardening checklist for production

- [ ] `HAMSA_SECRET` is 48+ random bytes, stored in a secret manager, backed up separately from the database.
- [ ] `HAMSA_ADMIN_PASSWORD` was changed through the UI after first login.
- [ ] Cookies are `Secure` (`HAMSA_SECURE_COOKIES=true` behind TLS).
- [ ] The app is behind a reverse proxy that terminates TLS and sets `X-Forwarded-For`.
- [ ] `data/` is on a volume with restricted permissions (mode 700, owner = app user).
- [ ] Backups are encrypted and tested by restoring into a scratch container.
- [ ] `CRON_SECRET` is random and the cron endpoint is not publicly documented.
- [ ] Provider keys are scoped to the minimum product and rotated on a schedule.
- [ ] Log retention matches the legal basis recorded in your cases.

## Known limitations

1. **In-process rate limiting.** Fine for a single instance; a multi-replica deployment needs a shared store (Redis) or the limiter becomes per-replica.
2. **SQLite single writer.** WAL allows concurrent readers but one writer at a time. This is a feature for an investigation tool; it is not a platform for hundreds of concurrent analysts.
3. **No MFA.** The role model and session revocation are the only account-takeover defences beyond the password. Add TOTP before exposing this to the open internet.
4. **Print-to-PDF depends on the browser.** There is no server-side renderer, so the export reflects the operator's print settings.
5. **Audit log is append-only by convention**, not by database trigger. A root-level attacker with the file can rewrite it. Ship the log to an external sink if you need non-repudiation.
6. **Camera probe is SSRF-capable by design.** Restrict enrolment to trusted operators and keep the service off untrusted networks.

## Reporting a vulnerability

Open a private security advisory on the repository rather than a public issue. Include reproduction steps, the affected version and the impact you believe it has. Expect an acknowledgement within a few days.
