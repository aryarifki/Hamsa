# Deployment

Hamsa is a single Node process with a SQLite file. It runs comfortably on a 1 vCPU / 1 GB VPS for a small team.

## Requirements

- Node.js **22.5+** (24 LTS recommended) — the app uses the built-in `node:sqlite` module.
- A writable directory for the database (`./data` by default).
- Optional: a TLS-terminating reverse proxy.

No Redis, no Postgres, no separate worker, no build-time API keys.

## Environment

Copy `.env.example` to `.env` and set at minimum:

```ini
HAMSA_SECRET=<openssl rand -base64 48>
HAMSA_ADMIN_EMAIL=you@example.org
HAMSA_ADMIN_PASSWORD=<a strong, unique password>
HAMSA_SECURE_COOKIES=true
NEXT_PUBLIC_APP_URL=https://hamsa.example.org
```

`HAMSA_SECRET` encrypts provider keys and camera passwords. **Losing it means those secrets are unrecoverable** — the database stays readable, but stored credentials must be re-entered. Back it up separately from the database.

## Docker Compose (recommended)

```bash
git clone https://github.com/aryarifki/Hamsa.git
cd Hamsa
cp .env.example .env
$EDITOR .env
docker compose up -d --build
docker compose logs -f
```

The compose file mounts a named volume at `/app/data`, runs as a non-root user, and health-checks `/api/health`. Put a reverse proxy in front for TLS:

```nginx
server {
  listen 443 ssl http2;
  server_name hamsa.example.org;

  ssl_certificate     /etc/letsencrypt/live/hamsa.example.org/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/hamsa.example.org/privkey.pem;

  client_max_body_size 2m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}
```

Keep the app bound to loopback (the compose file publishes `127.0.0.1:3000:3000`) so only the proxy is reachable.

## Bare metal with systemd

```bash
sudo useradd --system --home /opt/hamsa --shell /usr/sbin/nologin hamsa
sudo -u hamsa git clone https://github.com/aryarifki/Hamsa.git /opt/hamsa/app
cd /opt/hamsa/app
sudo -u hamsa npm ci
sudo -u hamsa npm run build
sudo -u hamsa mkdir -p data
```

`/etc/systemd/system/hamsa.service`:

```ini
[Unit]
Description=Hamsa OSINT console
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hamsa
Group=hamsa
WorkingDirectory=/opt/hamsa/app
EnvironmentFile=/opt/hamsa/app/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=3

# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/hamsa/app/data
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hamsa
curl -s http://127.0.0.1:3000/api/health
```

## Scheduler

Continuous monitoring needs an external trigger. Pick one:

**cron**

```cron
*/15 * * * * curl -fsS -X POST https://hamsa.example.org/api/v1/cron/watchlist \
  -H "x-cron-secret: $CRON_SECRET" >/dev/null
```

**systemd timer** — `hamsa-watchlist.service` runs the same `curl`, `hamsa-watchlist.timer` fires every 15 minutes (`OnUnitActiveSec=15min`).

The endpoint runs at most 10 due entries per call. Entries whose owner cannot afford the lookup are skipped, never overdrawn.

## Backups

SQLite in WAL mode must be snapshotted consistently. `VACUUM INTO` is the simplest correct method:

```bash
sqlite3 /opt/hamsa/app/data/hamsa.db \
  "VACUUM INTO '/var/backups/hamsa-$(date +%F).db'"
```

For Docker:

```bash
docker compose exec app sh -c \
  'apk add --no-cache sqlite >/dev/null 2>&1 || true; \
   sqlite3 /app/data/hamsa.db "VACUUM INTO '"'"'/app/data/backup.db'"'"'"'
docker compose cp app:/app/data/backup.db ./hamsa-$(date +%F).db
docker compose exec app rm /app/data/backup.db
```

Encrypt the result (`age`, `gpg`) before it leaves the host. Keep `HAMSA_SECRET` in a *different* backup location — a stolen database plus a stolen key is a full compromise of every stored credential.

Suggested retention for an investigation practice: 7 daily, 4 weekly, 12 monthly, with a documented deletion date that matches the retention clause in your engagement.

## Upgrades

```bash
cd /opt/hamsa/app
git pull
sudo -u hamsa npm ci
sudo -u hamsa npm run build
sudo systemctl restart hamsa
```

Schema changes are applied idempotently on boot (`CREATE TABLE IF NOT EXISTS`). There is no migration tool, so review the diff of `lib/db.ts` before upgrading across a release that alters a column: adding a column to an existing table needs a manual `ALTER TABLE` in your environment.

## Scaling

| Symptom | First move |
| --- | --- |
| Slow lookups | Most latency is the upstream provider; check `duration_ms` per module before changing anything |
| Many concurrent analysts | Move to Postgres (only `lib/db.ts` knows about SQLite) and replace `lib/rate-limit.ts` |
| Large history table | Archive `lookups` older than the retention window into a separate database file |
| PDF/export volume | Move print rendering to a headless browser worker; the rest of the app is unaffected |

Do not run multiple replicas against one SQLite file over a network share. WAL requires a local filesystem.

## Observability

- `GET /api/health` — liveness and database reachability; suitable for Docker/systemd/uptime checks.
- `audit_log` — who did what; query it from the admin screen or with `sqlite3`.
- Application logs go to stdout; ship them with journald or your container runtime.
- There are no metrics endpoints. If you need them, add a Prometheus text endpoint that reads `COUNT(*)` from `lookups` — do not pull in an APM agent for a single-process app.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `HAMSA_SECRET is unset or still the placeholder` | Production boot without a secret | Set it in the environment and restart |
| `SQLITE_BUSY` under load | Long write transaction or a second writer | Ensure WAL is enabled (it is), avoid concurrent `sqlite3` writes, keep transactions short |
| Login returns to `/login` with no error | Cookie rejected: `Secure` over plain HTTP | Set `HAMSA_SECURE_COOKIES=false` for local HTTP, or serve over TLS |
| 502 on a lookup | Provider rejected the key or timed out | Credits were refunded; check `history` for the stored error and the provider dashboard |
| Cron returns `503` | `CRON_SECRET` unset | Set it and restart |
| Empty maps/graphs | Missing `public/` assets or an ad-blocker hiding SVG | Check the browser console |
