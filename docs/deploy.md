# Deploying SFF Taxi to production

One server runs everything: a 4 vCPU / 8 GB RAM / 80+ GB SSD VPS with Ubuntu 24.04 in an Uzbek
data centre. Uzbekistan's personal data law requires personal data of Uzbek citizens (phones,
names, trips, driver passports and licences) to be stored on servers physically in Uzbekistan
(market analysis §4). That covers the database, the driver documents **and their backups**, so
the off-site backup copy must also stay in the country.

The layout is SFF Eats' (same scripts and safeguards), with the taxi's own parts: the worker's
dispatch loop, the private document store, prepaid card payments, fiscal receipts.
Incidents: [runbook.md](runbook.md). Regulation-driven integrations:
[fiscal-and-licence.md](fiscal-and-licence.md). Card payments: [payments.md](payments.md).

## What runs where

```
Internet ──443──> caddy ──┬── api.<domain>    ──> api (1..n instances) ──┬── postgres
                          ├── panel.<domain>  ──> web (operator panel)   ├── redis
                          │     └── /v1/*     ──> api                    ├── seaweedfs (S3, private)
                          └── files.<domain>  ──> seaweedfs              └── osrm (road router)
                                       worker (outbox, dispatch loop, housekeeping) ──┘
```

| Service                                  | Image / source                    | Role                                                                                            |
| ---------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `caddy`                                  | `caddy:2.10-alpine`               | HTTPS (Let's Encrypt, automatic renewal), proxy, security headers, SSE without buffering        |
| `api`                                    | `Dockerfile` (`sff-taxi-api`)     | NestJS API on :3200, `API_REPLICAS` instances, runtime role `taxi_app`                          |
| `worker`                                 | same image, `node dist/worker.js` | outbox (realtime, push/SMS, fiscal receipts, licence checks), dispatch loop (1 s), housekeeping |
| `migrate`                                | same image, one-shot              | applies pending migrations as `taxi_owner`; api/worker start only after it succeeds             |
| `web`                                    | `Dockerfile.web` (`sff-taxi-web`) | the built operator panel, served by Caddy as a non-root user                                    |
| `postgres`                               | `pgvector/pgvector:pg17`          | PostgreSQL 17, tuned for this server size (`deploy/docker-compose.prod.yml`)                    |
| `redis`                                  | `redis:7-alpine`                  | cache and short-lived state only (below); password, AOF, 384 MB, noeviction                     |
| `seaweedfs`                              | profile `seaweedfs`               | private S3-compatible store for driver documents and photos behind `files.<domain>`             |
| `osrm`                                   | profile `osrm`                    | road distances and ETAs for fares and dispatch (`deploy/osrm/prepare.sh`)                       |
| `prometheus`, `grafana`, `node-exporter` | profile `monitoring`              | metrics, dashboard, alert rules (below); `redis-exporter` for Redis memory                      |

Only Caddy publishes ports (80, 443/tcp, 443/udp). Grafana listens on `127.0.0.1` only.
Every container has a restart policy, CPU/memory limits and rotated JSON logs (5 × 10 MB).

**One worker is enough** (dispatch every second, outbox every 300 ms). A second one is safe:
rides, offers and outbox events are claimed with `SKIP LOCKED`; it only adds throughput.

### What Redis holds

Rate-limit counters (including the per-phone wrong-OTP counter), SSE stream tickets (60 s),
driver GPS trails (the last 20 points, for the rider's map and share links), geocoder and
route caches, and the realtime pub/sub channel. Sign-in codes, sessions, rides and money live
in Postgres. Losing Redis costs a minute of rate-limit memory, reopened event streams, short
car trails and cold caches, so it is **not backed up**; AOF only keeps counters across
restarts. It runs with `maxmemory 384mb` and `noeviction`: when full it refuses writes (visible
errors; the `RedisMemoryHigh` alert fires at 80 % first) instead of silently evicting keys the
API relies on. Every key has a TTL.

## 1. Before you start

- **Domain**: `api.<domain>`, `panel.<domain>`, `files.<domain>` (the last with the bundled
  SeaweedFS), plus the share-trip page origin (`SHARE_BASE_URL`, e.g. `taxi.<domain>`: links
  `…/t/<token>` must open a page that reads `GET /v1/share/<token>`). **A records** pointing at
  the server before the first start (Let's Encrypt needs them).
- **VPS** in an Uzbek data centre (UzCloud, Uztelecom DC, Sarkor, TPS…), Ubuntu 24.04, SSH key.
- **Accounts and keys** (fill in `.env.prod`): SMS provider (Eskiz or Play Mobile, approved
  OTP template and the phone-order SMS templates), Payme and/or Click merchant (card rides and
  driver top-ups), Yandex Geocoder and Maps JS keys, Expo project (push), optional Sentry
  project, a GitHub token that can read the images.
- **Legal**: the aggregator registration and the integrations in
  [fiscal-and-licence.md](fiscal-and-licence.md). The platform runs without them (receipts are
  kept, licences checked by hand), but launching rides for money needs them.

## 2. Prepare the server (once)

Identical to SFF Eats (a `deploy` user with SSH keys only, UTC time, 2 GB swap,
`vm.overcommit_memory=1` for Redis, ufw allowing only SSH/80/443, fail2ban, unattended upgrades
with a 04:30 reboot, Docker Engine from Docker's repository with `live-restore` and log
rotation):

```bash
# as root
adduser --disabled-password --gecos '' deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh

timedatectl set-timezone UTC
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
echo 'vm.overcommit_memory=1' > /etc/sysctl.d/99-redis.conf && sysctl --system

apt-get update && apt-get install -y ufw fail2ban unattended-upgrades rclone curl git
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable
printf '[sshd]\nenabled = true\nmaxretry = 5\nbantime = 1h\n' > /etc/fail2ban/jail.local
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades
printf 'Unattended-Upgrade::Automatic-Reboot "true";\nUnattended-Upgrade::Automatic-Reboot-Time "04:30";\n' \
  > /etc/apt/apt.conf.d/52sff-taxi

curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" }, "live-restore": true }' \
  > /etc/docker/daemon.json
systemctl restart docker
```

## 3. Get the deployment files and registry access

```bash
# as deploy
sudo mkdir -p /opt/sff-taxi && sudo chown deploy:deploy /opt/sff-taxi
git clone https://github.com/<owner>/<repo>.git /opt/sff-taxi   # a read-only deploy key is enough
cd /opt/sff-taxi
echo '<read:packages token>' | docker login ghcr.io -u <github user> --password-stdin
```

## 4. Configure

```bash
cp deploy/.env.prod.example deploy/.env.prod
chmod 600 deploy/.env.prod
deploy/gen-secrets.sh          # prints fresh secrets: paste each over its empty line
nano deploy/.env.prod          # domains, image tags, providers' keys
```

Every variable is documented in [deploy/.env.prod.example](../deploy/.env.prod.example),
grouped and marked `[required]`/`[optional]`. The API refuses to start with an invalid
combination (`SMS_PROVIDER=console` in production, half a Payme or storage configuration, no
`METRICS_TOKEN`, a `TEST_CALENDAR_AT`) and names the variable in `deploy/compose.sh logs api`.
Store the filled `.env.prod` in the password manager.

**File storage** (driver documents are personal data: never a public bucket):

- **Bundled SeaweedFS** (default): keep `seaweedfs` in `COMPOSE_PROFILES`, set `FILES_DOMAIN`,
  `STORAGE_S3_*` as in the example. The generated key pair becomes SeaweedFS' only identity;
  there is no anonymous access; `storage-init` creates the bucket on first start. The apps
  upload and read with presigned URLs for `files.<domain>`.
- **External S3** in Uzbekistan: remove `seaweedfs` from `COMPOSE_PROFILES`, leave
  `FILES_DOMAIN` empty, set `STORAGE_S3_ENDPOINT` (and `STORAGE_S3_PUBLIC_ENDPOINT` if the apps
  reach it elsewhere), keys and bucket. The bucket must be private.

**Road routing** (strongly advised: fares and dispatch ETAs are better with road distances):
`deploy/osrm/prepare.sh` (Geofabrik Uzbekistan extract, a few minutes, ~1 GB RAM peak), keep
`osrm` in `COMPOSE_PROFILES`, `ROUTER=osrm`, `OSRM_URL=http://osrm:5000`. Without it the API
uses the straight line × 1.35. Refresh monthly with the same script.

**App configuration** (`GET /v1/config`, read by the apps at start): `SUPPORT_PHONE`,
`SUPPORT_TELEGRAM`, `OFFICE_ADDRESS` (where drivers top up in cash), `MIN_RIDER_APP_VERSION`,
`MIN_DRIVER_APP_VERSION` (raise only after the new build is live in both stores).

## 5. First start

```bash
deploy/compose.sh up -d
deploy/compose.sh ps                       # migrate: Exited (0); api, worker, web: healthy
deploy/compose.sh logs migrate             # "10 migration(s) applied"
curl -fsS https://api.<domain>/health      # {"status":"ok","database":"up","redis":"up"}
curl -fsSI https://panel.<domain>/ | head -1
```

Then, once:

1. **Operators**: sign in to `https://panel.<domain>` with a phone from `ADMIN_PHONES`.
2. **Settings** in the panel: tariff (and per-city overrides), dispatch, billing (promo end
   date, commission, caps, passes), intercity (price band, cancellation) and fiscal (item
   names; the MXIK codes once confirmed).
3. **Payments**: Payme cabinet endpoint `https://api.<domain>/v1/payments/payme` with the
   account field `order_id`; Click cabinet Prepare/Complete
   `https://api.<domain>/v1/payments/click/prepare|complete`. Test with `PAYME_TEST=true` and a
   top-up of 5 000 first ([payments.md](payments.md)).
4. **Backups**: schedule them (next section) and run one by hand: `deploy/backup.sh`.
5. **Monitoring**: an external uptime check and alerts (section 8).

## 6. Backups and the restore drill

`deploy/backup.sh` (settings from `.env.prod`):

1. `pg_dump` (custom format, compressed) to `deploy/backups/taxi-<UTC time>.dump`;
2. checks the dump reads back (`pg_restore --list`) before anything is rotated;
3. with `BACKUP_FILES=true`: an archive of the SeaweedFS volume (driver documents and photos)
   `taxi-files-<time>.tar.gz`, taken while it runs (files are written once);
4. deletes local copies older than `BACKUP_RETENTION_DAYS` (14);
5. copies them off the server with rclone when `BACKUP_RCLONE_REMOTE` is set (and prunes remote
   copies older than `BACKUP_REMOTE_RETENTION_DAYS`, 60);
6. pings `BACKUP_PING_URL` (a dead-man switch) or its `/fail` URL on error.

```bash
sudo tee /etc/cron.d/sff-taxi <<'EOF'
30 3 * * * deploy /opt/sff-taxi/deploy/backup.sh >> /var/log/sff-taxi-backup.log 2>&1
EOF
sudo touch /var/log/sff-taxi-backup.log && sudo chown deploy /var/log/sff-taxi-backup.log
```

**Off-site copy**: another provider or data centre **inside Uzbekistan**, through an rclone
`crypt` remote so the copies are encrypted before they leave (`rclone config`: a remote
`uzs3` of type s3/sftp, then `uzbackup` of type crypt over it; `BACKUP_RCLONE_REMOTE=uzbackup:`;
keep `rclone config file` in the password manager).

**Restore drill** (monthly, and after every Postgres major upgrade); it never touches `taxi`:

```bash
deploy/restore.sh deploy/backups/taxi-<stamp>.dump taxi_drill   # restores + row counts per table
deploy/compose.sh exec postgres psql -U taxi_owner -d taxi -c "SELECT count(*) FROM rides"
deploy/compose.sh exec postgres dropdb -U taxi_owner taxi_drill
# files: list the archive, and restore it into a scratch volume now and then
tar -tzf deploy/backups/taxi-files-<stamp>.tar.gz | head
```

## 7. Releases, updates, rollback

```bash
git tag v1.2.0 && git push origin v1.2.0
# the Images workflow -> ghcr.io/<owner>/sff-taxi-api:1.2.0, ghcr.io/<owner>/sff-taxi-web:1.2.0
```

On the server:

```bash
cd /opt/sff-taxi && git pull                          # deploy/ files (compose, Caddyfile, scripts)
sed -i 's/:1.1.0$/:1.2.0/' deploy/.env.prod           # or edit TAXI_API_IMAGE / TAXI_WEB_IMAGE
deploy/update.sh
```

`deploy/update.sh` pulls, runs pending migrations (a failure stops the deploy with the old
version serving; each migration waits at most 10 s for a table lock, then fails instead of
freezing the live API), starts new API instances next to the old ones, waits for them to be
healthy, stops the old ones, recreates the worker and panel, and reloads Caddy.

**Rollback**: put the previous tags back and run `deploy/update.sh` again; safe while the
schema still suits the old code. **Migrations stay backward compatible for one release**
(expand/contract), and are never edited once applied (a checksum refuses it).

Zero-downtime notes (measured on SFF Eats with the same Caddy config: 0 failed requests of
2 214 during two rolling deploys under load): run `API_REPLICAS=2`; open SSE streams on a
stopped instance end and the apps reconnect within 3 s and refetch; the worker restart leaves
events waiting in the outbox and the dispatch loop resumes where it was (offers have their own
deadlines in the database). Postgres/Redis restarts are not zero-downtime: night window.

## 8. Monitoring and alerts

`COMPOSE_PROFILES=…,monitoring` adds Prometheus (30 days / 5 GB), node-exporter, redis-exporter
and Grafana with the provisioned **SFF Taxi overview** dashboard. Grafana only through an SSH
tunnel: `ssh -L 3000:127.0.0.1:3000 deploy@<server>`.

| Source                 | What                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| API `GET /health`      | Postgres and Redis reachable (the Docker health check)                                                      |
| API `GET /metrics`     | `http_request_duration_seconds{method,route,status}` + Node.js; 404 from outside, `METRICS_TOKEN` inside    |
| Worker `:3201/health`  | outbox loop alive (a cycle in the last 60 s) and database reachable                                         |
| Worker `:3201/metrics` | `outbox_pending_events`, `outbox_oldest_pending_seconds`, `outbox_dead_events`, `outbox_dispatch_total`     |
| Logs                   | pino JSON (tokens, share links, stream tickets and phones redacted), `deploy/compose.sh logs -f api worker` |

Alert rules (`deploy/monitoring/alerts.yml`): API or worker down, outbox backlog > 100 or the
oldest event older than 5 min, any dead outbox event (a push, a receipt or a dispatch step that
gave up), 5xx > 1 %, p95 > 1 s, payment callbacks answering 5xx, disk < 15 %, memory < 10 %,
Redis down / above 80 % / refusing writes.

Deliver them from Grafana to the operators' Telegram group, and set up outside the server an
uptime monitor on `https://api.<domain>/health` and `https://panel.<domain>/` plus the backup
dead-man switch. Sentry (optional, `SENTRY_DSN`) receives errors without personal data; if
even that conflicts with localisation, self-host GlitchTip in Uzbekistan.

## 9. Rehearsing locally

The same files run on a workstation. An env file with `api.localhost`, `panel.localhost`,
`files.localhost` (Caddy's internal CA), non-conflicting ports and locally built images:

```bash
docker build -t sff-taxi-api:local . && docker build -f Dockerfile.web -t sff-taxi-web:local .
COMPOSE_PROJECT_NAME=taxi-rehearsal TAXI_ENV_FILE=/path/to/local.env deploy/compose.sh up -d
curl -k --resolve api.localhost:8543:127.0.0.1 https://api.localhost:8543/health
COMPOSE_PROJECT_NAME=taxi-rehearsal TAXI_ENV_FILE=/path/to/local.env deploy/compose.sh down -v
```

Rehearsal log: see the end of this file.

## Files

| Path                                       | Purpose                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `Dockerfile`                               | API image (API, worker, migrations), non-root, prod deps only    |
| `Dockerfile.web`                           | operator panel image (static build served by Caddy, non-root)    |
| `deploy/docker-compose.prod.yml`           | the production stack                                             |
| `deploy/.env.prod.example`                 | every setting, grouped and documented                            |
| `deploy/compose.sh`                        | `docker compose` with the right file and env file                |
| `deploy/update.sh`                         | rolling deploy / rollback                                        |
| `deploy/backup.sh`, `deploy/restore.sh`    | nightly backup (database and files), restore into a new database |
| `deploy/gen-secrets.sh`                    | fresh secrets                                                    |
| `deploy/Caddyfile`, `deploy/web.Caddyfile` | edge proxy (SSE, retries, private file host); panel file server  |
| `deploy/postgres/init-roles.sh`            | creates the runtime role on first start                          |
| `deploy/seaweedfs/storage-init.mjs`        | creates the private bucket                                       |
| `deploy/osrm/prepare.sh`                   | builds/refreshes the Uzbekistan road graph                       |
| `deploy/monitoring/`                       | Prometheus config, alert rules, Grafana provisioning/dashboard   |
| `.github/workflows/ci.yml`, `images.yml`   | checks on every push/PR; image publishing on tags                |

## Rehearsal log

2026-09-27, Windows workstation, Docker Desktop, the production files with a local env
(`api.localhost`, `panel.localhost`, `files.localhost` on :8543, profiles `seaweedfs` and
`monitoring`, two API replicas, locally built images):

- `docker build` of both images succeeded; `migrate` applied the 10 migrations, `storage-init`
  created the private bucket; api ×2, worker, web healthy; Prometheus scraped api ×2, worker,
  node and redis (`up`).
- Through Caddy: `/health` ok, the panel served with `/v1` proxied to the API, `/metrics` 404
  from outside, the file host refused an anonymous read (403); an operator signed in, uploaded
  a PDF document with a presigned PUT through `files.localhost`, the API checked it and handed
  out a presigned GET (200); the SSE stream delivered its first event at once (no buffering).
- `deploy/backup.sh` wrote the dump and the file-store archive; `deploy/restore.sh` restored
  into `taxi_restored` with all 10 migrations and refused to restore over `taxi`.
- `deploy/update.sh` rolled the API instances with a health probe every 0.5 s: 90 of 90 answered 200.
- `deploy/compose.sh down -v` removed everything.
