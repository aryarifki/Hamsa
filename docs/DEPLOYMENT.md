# Deployment

Hamsa is one Node process in front of PostgreSQL, plus `ffmpeg` for cameras. It runs comfortably on a 2 vCPU / 2 GB VPS for a small team; the database and snapshot storage grow with use.

## Requirements

- Node.js **24** (the Docker image and the test scripts are built for it).
- **PostgreSQL 15+**, reachable over TCP or a Unix socket.
- **ffmpeg** on `PATH` (or `HAMSA_FFMPEG_PATH`) for RTSP probes, stills and motion frames.
- A writable private directory for snapshots (`/app/storage` in Docker).
- Optional: a TLS-terminating reverse proxy.

No Redis, no message queue, no separate worker, no build-time API keys.

## Environment

Copy `.env.example` to `.env` and set at minimum:

```ini
DATABASE_URL=postgres://hamsa:<password>@127.0.0.1:5432/hamsa
HAMSA_SECRET=<openssl rand -base64 48>
HAMSA_ADMIN_EMAIL=you@example.org
HAMSA_ADMIN_PASSWORD=<a strong, unique password>
HAMSA_SECURE_COOKIES=true
NEXT_PUBLIC_APP_URL=https://hamsa.example.org
HAMSA_STORAGE_DIR=/opt/hamsa/storage
CRON_SECRET=<openssl rand -hex 24>
```

`HAMSA_SECRET` encrypts provider keys and camera passwords. **Losing it means those secrets are unrecoverable** — the database stays readable, but stored credentials must be re-entered. Back it up separately from the database.

The app applies the baseline schema and every pending migration on boot, guarded by a PostgreSQL advisory lock so several workers cannot race. You can also run migrations explicitly (see below).

## Docker Compose (recommended)

```bash
git clone https://github.com/aryarifki/Hamsa.git
cd Hamsa
cp .env.example .env
$EDITOR .env            # HAMSA_SECRET, POSTGRES_PASSWORD, admin credentials
docker compose up -d --build
docker compose logs -f
```

Compose starts `postgres:17-alpine` with a named volume, waits for `pg_isready`, then starts the app with `DATABASE_URL` pointing at the service. Two volumes matter:

| Volume | Mount | Contents |
| --- | --- | --- |
| `hamsa-pg` | `/var/lib/postgresql/data` | Database |
| `hamsa-storage` | `/app/storage` | Camera snapshots (private, never served by the proxy) |

The app container runs read-only apart from the storage volume and a `/tmp` tmpfs, as a non-root user, with all capabilities dropped. Put a reverse proxy in front for TLS:

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

Keep the app bound to loopback (the compose file publishes `127.0.0.1:3000:3000`). **Do not** add a proxy location for `/app/storage` or `storage/` — snapshots are served only by the authenticated API route.

## Bare metal with systemd

Install PostgreSQL and ffmpeg first (`apt install postgresql ffmpeg` or the equivalent), create a database and role, then:

```bash
sudo useradd --system --home /opt/hamsa --shell /usr/sbin/nologin hamsa
sudo -u hamsa git clone https://github.com/aryarifki/Hamsa.git /opt/hamsa/app
cd /opt/hamsa/app
sudo -u hamsa npm ci
sudo -u hamsa npm run build
sudo -u hamsa mkdir -p /opt/hamsa/storage
sudo chmod 700 /opt/hamsa/storage
```

`.env` (readable only by the service user):

```ini
DATABASE_URL=postgres://hamsa:<password>@127.0.0.1:5432/hamsa
HAMSA_SECRET=...
HAMSA_STORAGE_DIR=/opt/hamsa/storage
NODE_ENV=production
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
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=3

# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/hamsa/storage
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

If PostgreSQL listens on a Unix socket only, point `DATABASE_URL` at it (`postgres:///hamsa?host=/var/run/postgresql`) and grant the service user access to the socket directory.

## Migrations

Migrations are reversible by design, but a down migration can only restore what the older schema can represent. Each migration declares its lossy parts in `dataLoss`; read them before rolling back in production.

```bash
npm run migrate status   # applied / pending, with timestamps
npm run migrate up       # apply everything (also happens on boot)
npm run migrate down     # roll back the most recent migration
```

The `down` command prints the migration's `dataLoss` note. In particular, rolling back `002_camera_monitor` restores `cctv_assets` and keeps credentials, but drops snapshot/event history; rolling back `003_consent_geofencing` restores `devices`/`device_pings` and the old fence shape, but drops org-wide fences (`device_id IS NULL`) and notification rows.

All migrations run inside a transaction. Take a backup before any `down` in production.

## Scheduler

Both jobs need an external trigger. Pick cron, a systemd timer, or your platform's scheduler:

```cron
# cameras: every minute; the endpoint respects each camera interval itself
* * * * * curl -fsS -X POST https://hamsa.example.org/api/v1/cron/cameras \
  -H "x-cron-secret: $CRON_SECRET" >/dev/null

# watchlist: every 15 minutes
*/15 * * * * curl -fsS -X POST https://hamsa.example.org/api/v1/cron/watchlist \
  -H "x-cron-secret: $CRON_SECRET" >/dev/null
```

The camera pass handles at most `HAMSA_CAMERA_BATCH` cameras (default 5, max 25), skips cameras in `disabled_auth`/`needs_config`, and prunes snapshots older than `HAMSA_SNAPSHOT_RETENTION_DAYS` (default 14) on every pass. If a capture takes longer than one minute, lower the batch rather than shortening ffmpeg timeouts.

The watchlist pass runs at most 10 due entries; owners who cannot afford the lookup are skipped, never overdrawn.

## Backups

A backup is two artifacts: the database and the snapshot directory. Keep `HAMSA_SECRET` in a **third**, separate location.

```bash
# database (custom format, compressed)
pg_dump -Fc "$DATABASE_URL" -f /var/backups/hamsa-$(date +%F).dump

# snapshots (may include files written during the tar; that is harmless)
tar -C /opt/hamsa/app -czf /var/backups/hamsa-storage-$(date +%F).tar.gz storage
```

Docker:

```bash
docker compose exec -T postgres pg_dump -U hamsa -Fc hamsa > hamsa-$(date +%F).dump
docker run --rm -v hamsa_hamsa-storage:/data -v "$PWD":/backup alpine \
  tar -C /data -czf /backup/hamsa-storage-$(date +%F).tar.gz .
```

Restore into a scratch environment first:

```bash
pg_restore --clean --if-exists -d "$DATABASE_URL" hamsa-2026-10-22.dump
tar -C /opt/hamsa/app -xzf hamsa-storage-2026-10-22.tar.gz
```

Encrypt both artifacts (`age`, `gpg`) before they leave the host. A stolen database plus a stolen `HAMSA_SECRET` is a full compromise of every stored credential. Snapshot files are unencrypted JPEGs at rest — rely on volume encryption and filesystem permissions (directory mode `0700`).

Suggested retention for an investigation practice: 7 daily, 4 weekly, 12 monthly, with a documented deletion date that matches the retention clause in your engagement.

## Upgrades

```bash
cd /opt/hamsa/app
git pull
sudo -u hamsa npm ci
sudo -u hamsa npm run build
sudo systemctl restart hamsa
```

Migrations apply on boot. For a controlled rollout, run `npm run migrate status` before restarting and `npm run migrate up` explicitly, then restart. Camera capture is skipped while the process restarts; the next cron pass catches up.

## Scaling

| Symptom | First move |
| --- | --- |
| Slow lookups | Most latency is the upstream provider; check `duration_ms` per module before changing anything |
| Many concurrent analysts | Raise `HAMSA_PG_POOL` modestly; PostgreSQL handles the concurrency. Keep the pool below the server's connection limit |
| Large `device_locations` table | Archive or partition by `ts`; the UI only reads the latest row and a bounded history |
| Large `lookups` table | Archive rows older than the retention window to a separate database |
| Snapshot volume | Lower `HAMSA_SNAPSHOT_RETENTION_DAYS`, or archive `storage/cameras/<id>/` to object storage and update `file_path` |
| PDF/export volume | Move print rendering to a headless browser worker; the rest of the app is unaffected |

Multiple app replicas can share PostgreSQL, but two things are per-process today: the rate limiter and the camera scheduler. Run the camera cron against **one** replica (or add a PostgreSQL advisory lock around the pass) and move rate limiting to Redis before scaling auth/lookup traffic horizontally.

## Observability

- `GET /api/health` — liveness and database reachability; suitable for Docker/systemd/uptime checks.
- `audit_log` — who did what; query it from the admin screen or with `psql`.
- In-app notifications — camera fail-closed alerts and geofence transitions.
- Application logs go to stdout; ship them with journald or your container runtime. ffmpeg's stderr is truncated and redacted before it is stored.
- There are no metrics endpoints. If you need them, add a Prometheus text endpoint that reads `COUNT(*)` from `lookups` — do not pull in an APM agent for a single-process app.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `DATABASE_URL is not set` | Missing environment | Set it in `.env` / the unit file and restart |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL down, wrong host/port, or `pg_hba.conf` rejects the role | `pg_isready`, check the URL and `pg_hba.conf` |
| `password authentication failed` | Wrong password, or special characters not URL-encoded | Reset the role password and percent-encode it in `DATABASE_URL` |
| `HAMSA_SECRET is unset or still the placeholder` | Production boot without a secret | Set it and restart |
| `ffmpeg not found` / camera probe fails instantly | Binary missing from `PATH` | Install ffmpeg or set `HAMSA_FFMPEG_PATH` |
| Camera flips to `disabled_auth` | The camera returned 401/403 | Fix the username/password, then **Re-enable**; it will not retry on its own |
| Camera stays `offline` | RTSP unreachable, wrong path, or timeout | Test with `ffmpeg -rtsp_transport tcp -i <url> -frames:v 1 out.jpg` from the app host |
| Snapshot route 404 | Caller does not own the camera, or the file was pruned | Check the camera owner and `HAMSA_SNAPSHOT_RETENTION_DAYS` |
| `EROFS` on capture | Storage directory not writable (read-only container) | Mount the storage volume at `HAMSA_STORAGE_DIR` |
| Login returns to `/login` with no error | Cookie rejected: `Secure` over plain HTTP | Set `HAMSA_SECURE_COOKIES=false` for local HTTP, or serve over TLS |
| 502 on a lookup | Provider rejected the key or timed out | Credits were refunded; check `history` for the stored error and the provider dashboard |
| Cron returns `503` | `CRON_SECRET` unset | Set it and restart |
