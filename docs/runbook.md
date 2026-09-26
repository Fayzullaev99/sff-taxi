# Runbook: production incidents

For the production layout in [deploy.md](deploy.md). All commands run on the server from
`/opt/sff-taxi`; `dc` is short for `deploy/compose.sh` (`alias dc=deploy/compose.sh`). SQL runs
with `dc exec postgres psql -U taxi_owner -d taxi`.

First minute of any incident:

```bash
dc ps                                            # what is down / unhealthy / restarting
dc logs --since 15m --tail 200 api worker caddy  # errors, stack traces
curl -fsS https://api.<domain>/health            # {"status":"ok",...} or which dependency is down
df -h / && free -m && uptime                     # disk, memory, load
```

Tell the dispatchers (they can take rides by phone and assign by hand) and the drivers' group
what is affected. Write a short note afterwards (what happened, impact, fix, follow-up).

## API down

**Symptoms**: uptime monitor or `ApiDown`, the apps show network errors, `/health` fails or 502.

1. `dc ps api`: are instances `healthy`?
   - **Restarting / exited**: `dc logs --tail 100 api`. `Invalid environment configuration`
     names the wrong variable in `.env.prod`: fix it, `dc up -d`. After a bad release, roll back
     (previous image tags, `deploy/update.sh`).
   - **Unhealthy with `database: down`**: Postgres below. **`redis: down`**: `dc logs redis`,
     `dc restart redis` (nothing important is lost: deploy.md, "What Redis holds").
   - **Healthy but the site fails**: Caddy. `dc logs --tail 100 caddy`; `dc restart caddy`.
2. Postgres down: `dc logs --tail 100 postgres`. Usual causes: disk full (below), out of memory
   (`dmesg -T | grep -i oom`), a crash loop after a config change.
3. Answers **503 "Server hozir band"**: the pool is exhausted (`DB_CONNECT_TIMEOUT_MS`) or a
   statement hit `DB_STATEMENT_TIMEOUT_MS`. **409 "qayta urinib ko‘ring"** in bursts: lock waits
   hit `DB_LOCK_TIMEOUT_MS` (a long transaction holds rows). Look at what runs:
   `SELECT pid, state, now() - xact_start AS age, wait_event_type, left(query, 80) FROM pg_stat_activity WHERE datname = 'taxi' ORDER BY age DESC NULLS LAST;`
   and end a stuck one with `SELECT pg_terminate_backend(<pid>);` (idle-in-transaction sessions
   end by themselves after `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`).
4. Too many connections: `API_REPLICAS × DB_POOL_MAX + workers × DB_POOL_MAX` must stay below the
   role limit (80) and `max_connections` (120).
5. **Certificates**: `dc logs caddy | grep -i -E 'acme|certificate'`; DNS must point here and
   80/443 be open (`ufw status`); `dc restart caddy` after fixing DNS.

## Rides are not dispatched

**Symptoms**: riders wait on "searching", drivers get no offers, operators see rides pile up in
the "attention" list.

1. Worker alive? `dc ps worker`; `dc logs --since 10m worker | tail -50`. `WorkerDown` or
   `status: stalled`: `dc restart worker` (the dispatch loop resumes from the database state:
   offers have their deadlines there).
2. Drivers really free? In the panel's live map: online, a GPS fix younger than 2 minutes,
   balance above the minimum, a valid licence card. SQL:
   ```sql
   SELECT count(*) FILTER (WHERE is_online) AS online,
          count(*) FILTER (WHERE is_online AND located_at > now() - interval '2 minutes') AS fresh_gps,
          count(*) FILTER (WHERE is_online AND licence_status <> 'valid') AS unverified_licence
   FROM drivers WHERE status = 'active';
   ```
   Stale GPS for everyone at once points at the driver app or the mobile network, not the
   server. Many drivers below the minimum balance: announce top-ups (cash at the office or
   Payme/Click in the app).
3. Routing: with `ROUTER=osrm` and the router down, ETAs fall back to the straight line (slower
   choices, still dispatched). `dc ps osrm`, `dc restart osrm`.
4. Meanwhile dispatchers assign by hand: panel → ride → candidates → assign.

## Worker stalled or outbox growing

**Symptoms**: `WorkerDown`, `OutboxBacklog`, `OutboxStale` or `OutboxDeadEvents`; apps stop
updating in real time, no pushes/SMS, receipts not issued, unpaid card rides not cancelled.

```bash
dc ps worker && dc logs --since 30m worker | tail -100
dc exec worker node -e "fetch('http://127.0.0.1:3201/health').then(r=>r.text()).then(console.log)"
```

```sql
SELECT topic, count(*), min(created_at) AS oldest, max(attempts) AS max_attempts
FROM outbox WHERE processed_at IS NULL GROUP BY topic ORDER BY oldest;
SELECT id, topic, attempts, next_attempt_at, left(last_error, 200) AS last_error
FROM outbox WHERE processed_at IS NULL AND attempts > 0 ORDER BY created_at LIMIT 20;
```

- **Worker unhealthy / stalled**: `dc restart worker`; events wait safely.
- **One topic keeps failing**: `last_error` names the handler (`notifications: …`,
  `fiscal: …`, `licence: …`, `intercity-notifications: …`) and the cause (Expo down, SMS
  balance, the OFD). Fix the cause; retries continue with backoff for 10 attempts. Each event
  is claimed with a 2-minute lease and counted at the claim, so a crashing event cannot loop.
- **Dead events**: the panel lists them (`GET admin/outbox?state=dead`) and retries one
  (`POST admin/outbox/:id/retry`). Handlers are idempotent and those that already succeeded for
  an event are skipped (`outbox_deliveries`). An event that must never be delivered:
  `UPDATE outbox SET processed_at = now() WHERE id = '<id>';`

## Payment callbacks failing

**Symptoms**: `PaymentCallbacksFailing`; riders paid but the ride stays "awaiting payment" (and
is cancelled after 10 minutes), drivers' top-ups do not arrive.

1. `dc logs --since 1h api | grep -E 'payments/(payme|click)'`:
   - no callbacks: the provider cannot reach us (health from outside, callback URLs in the
     cabinets: deploy.md step 5);
   - Payme authorization error: `PAYME_KEY` does not match the cabinet (test vs production,
     `PAYME_TEST`); Click `SIGN CHECK FAILED`: `CLICK_SECRET` / `CLICK_SERVICE_ID`;
   - 5xx: the stack trace (usually the database: API down).
2. The affected payments:
   ```sql
   SELECT i.id, i.purpose, i.status, i.amount, i.created_at, r.number AS ride, r.status AS ride_status,
          t.provider, t.state, t.external_id
   FROM payment_intents i
   LEFT JOIN rides r ON r.id = i.ride_id
   LEFT JOIN payment_transactions t ON t.intent_id = i.id
   WHERE i.created_at > now() - interval '3 hours' ORDER BY i.created_at DESC;
   ```
   Compare with the cabinets. Providers retry by themselves once we answer. A ride that was
   cancelled but paid appears in the refund queue (`GET admin/payments/refunds`): refund it in
   the Payme cabinet (the callback records it) or, for Click, reverse it and record it
   (`POST admin/payments/:id/refunded`). A top-up paid but expired: credit it by hand as a
   ledger `topup` with the provider's transaction id in the note. Never edit money rows.
3. Card payments can be switched off at once: clear the provider's variables in `.env.prod`,
   `dc up -d api worker`: riders are offered cash only, top-ups by cash at the office.

## SMS provider down

**Symptoms**: nobody can sign in (no code), phone-order riders get no SMS, operators get no SOS
SMS; `dc logs api worker | grep -i -E 'eskiz|playmobile|sms'`.

1. Provider cabinet: balance, sender name, **template approval** (`SMS_OTP_TEMPLATE` and the
   phone-order texts must match approved templates exactly).
2. Auth errors: update `ESKIZ_EMAIL`/`ESKIZ_PASSWORD`, `dc up -d api worker`.
3. Switch providers if the other is configured (`SMS_PROVIDER=playmobile`).
4. Signed-in users keep working (refresh tokens). SOS still reaches the panel in realtime; tell
   dispatchers to watch it. `OTP_FIXED_CODES` is for store reviewers only.

## Fiscal receipts not issued

**Symptoms**: `GET admin/fiscal/receipts?status=pending` grows, dead `fiscal.receipt_due`
events, riders see no receipt link.

1. `FISCAL_PROVIDER=none` means receipts are kept (`skipped`) by design until the OFD contract:
   nothing to fix; they are sent later with `POST admin/fiscal/receipts/resend {"status":"skipped"}`.
2. With a provider: `last_error` of the receipts and events names the OFD's answer (credentials,
   a rejected MXIK code: `admin/settings/fiscal`, the OFD down). Fix, then retry the dead events
   or `resend {"status":"pending"}`. A receipt is never issued twice (stable receipt number).

## Driver documents or photos not loading

**Symptoms**: uploads fail in the driver app (503 "Fayl yuklash serverda hali sozlanmagan", or
the PUT fails), operators see broken document links.

1. `dc ps seaweedfs`; `dc logs seaweedfs | tail`. `dc restart seaweedfs` (files are kept in the
   `s3data` volume).
2. The PUT fails with a signature error: `STORAGE_S3_PUBLIC_ENDPOINT` must be exactly the
   `https://files.<domain>` the apps reach (the host is signed); the Caddy site `FILES_DOMAIN`
   must exist.
3. Links expire after 15 minutes by design: reopen the view.

## Database disk full

**Symptoms**: `DiskAlmostFull`, Postgres `No space left on device`, writes fail.

```bash
df -h / && sudo du -xh --max-depth=2 /var/lib/docker | sort -h | tail -15
docker system df
ls -lh deploy/backups | tail
```

1. Free space without touching database files: `docker image prune -a --filter until=168h`,
   `docker builder prune -f`, old local backups (keep the newest two; the off-site copy has
   the rest), `sudo journalctl --vacuum-size=200M`.
2. Never delete files inside the Postgres volume (`pg_wal` included).
3. What grows:
   ```sql
   SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
   FROM pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
   ```
   Usual suspects: processed `outbox` rows, `ride_events`, `notifications`. Delete old
   processed outbox rows in batches (`DELETE FROM outbox WHERE id IN (SELECT id FROM outbox
WHERE processed_at < now() - interval '90 days' LIMIT 10000)`), then `VACUUM (ANALYZE) outbox`.
   Never delete rides, ledger or tax rows (money and tax records).
4. Long term: grow the disk (`growpart` + `resize2fs`) or move backups to their own disk.

## Restore from backup

Decide the restore point (the newest dump before the damage); everything after it is lost
unless re-entered, so tell dispatchers what time the data returns to.

```bash
ls -lh deploy/backups/                                    # or: rclone copy uzbackup:taxi-<stamp>.dump deploy/backups/
deploy/restore.sh deploy/backups/taxi-<stamp>.dump taxi_restored   # never touches "taxi"
dc exec postgres psql -U taxi_owner -d taxi_restored -c "SELECT max(requested_at) FROM rides"
```

Switch over (a few minutes of downtime):

```bash
dc stop api worker
deploy/backup.sh                        # keep the damaged state too
dc exec postgres psql -U taxi_owner -d postgres -c "ALTER DATABASE taxi RENAME TO taxi_damaged_$(date +%Y%m%d)"
dc exec postgres psql -U taxi_owner -d postgres -c "ALTER DATABASE taxi_restored RENAME TO taxi"
dc up -d                                # migrate runs first
curl -fsS https://api.<domain>/health
```

Card payments and top-ups made after the restore point exist at Payme/Click but not here:
reconcile them from the cabinets (ledger entries by hand, with the provider's ids in notes).
Rides completed after it have no tax rows: re-enter them before the monthly tax report.

**Files**: restore the newest `taxi-files-<stamp>.tar.gz` into the volume with SeaweedFS
stopped: `dc stop seaweedfs && docker run --rm -v sff-taxi-prod_s3data:/data -v "$PWD/deploy/backups:/b:ro" alpine:3 sh -c 'rm -rf /data/* && tar -xzf /b/taxi-files-<stamp>.tar.gz -C /data' && dc up -d seaweedfs`.

**Whole server lost**: a new server (deploy.md steps 2-4) with `.env.prod` from the password
manager, `dc up -d postgres`, fetch the newest off-site dump and file archive, restore both as
above, `dc up -d`, point DNS at the new server.

## Rotating secrets

Yearly, and at once when a secret may have leaked. New values: `deploy/gen-secrets.sh`; update
the password manager after changing `.env.prod`.

| Secret                    | How                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`       | Set, `deploy/update.sh`. Access tokens (15 min) become invalid; the apps refresh silently.                                       |
| `POSTGRES_APP_PASSWORD`   | `ALTER ROLE taxi_app PASSWORD '<new>';`, set it, `dc up -d api worker` (the init script does not run again).                     |
| `POSTGRES_OWNER_PASSWORD` | `ALTER ROLE taxi_owner PASSWORD '<new>';`, set it (used by `migrate` only).                                                      |
| `REDIS_PASSWORD`          | Set, `dc up -d redis api worker` (seconds of errors: night window).                                                              |
| `STORAGE_S3_*` keys       | Bundled SeaweedFS: set, `dc up -d seaweedfs api worker` (its identity comes from them at start). Presigned links in flight fail. |
| Payme / Click keys        | New key in the cabinet, set `PAYME_KEY` / `CLICK_SECRET`, `dc up -d api worker` right away (callbacks fail while they differ).   |
| SMS, Yandex, Expo tokens  | Issue at the provider, set, `dc up -d api worker`, revoke the old one.                                                           |
| `METRICS_TOKEN`           | Set, `dc up -d api prometheus`.                                                                                                  |
| GHCR read token           | New `read:packages` token, `docker login ghcr.io` again, delete the old one.                                                     |

## Redis memory

**Symptoms**: `RedisMemoryHigh` or `RedisRejectingWrites`; at the limit sign-in, rate-limited
routes and stream tickets answer errors (`noeviction` refuses writes).

1. What uses it: `dc exec redis redis-cli --bigkeys`; families: `geo:route:*` route cache,
   `geo:gc:*` geocoder cache, `geo:trail:*` driver trails, `rt:*` stream tickets, `rl:*` rate
   limits.
2. Quick relief: drop the caches (they rebuild):
   `dc exec redis sh -c "redis-cli --scan --pattern 'geo:route:*' | xargs -r -n 500 redis-cli del"`.
3. Traffic grew: raise `--maxmemory` in the compose file (below the container limit, with room
   for the AOF fork), `dc up -d redis`. Never switch to an `allkeys-*` eviction policy.

## Routine

- **Daily**: the Grafana dashboard; the backup ping arrived; the panel's refund queue, dead
  outbox events and driver appeals are empty or being handled.
- **Weekly**: `dc ps` all healthy; disk below 70 %; `docker image prune -a --filter until=336h`.
- **Monthly**: restore drill (deploy.md); `deploy/osrm/prepare.sh`; by the 15th, the 1%
  withholding report (`GET admin/billing/taxes?period=YYYY-MM`) to the accountant and
  `POST admin/billing/taxes/remit` once paid; image updates in the night window.
