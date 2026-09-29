# Production-readiness audit

The SFF Eats lessons checklist (`D:\sff-eats\docs\lessons-from-sff-automation.md`: bug classes
that hurt SFF Automation and sffmarket) applied to SFF Taxi on 2026-09-27. Numbers follow that
file. Status: **ok** (already handled), **fixed** (fixed by this audit, with a regression test),
**open** (a decision or later work). Regression tests: `test/audit.test.ts`,
`test/audit-infra.test.ts`, `test/calendar.test.ts` and the feature tests named below.

Re-run it before launch and after any change to ordering, payments, the outbox or auth.

## Money and rounding

| #   | Bug class                                          | SFF Taxi                                                                                                                                                                                                                                | Status                  |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | Racing provider callbacks, missing amount, regress | Payme/Click callbacks lock the intent (and ride) in one transaction; `(provider, external_id)` unique; one performed transaction per intent; amount required and compared in tiyin; states only move forward; two providers: first wins | ok (`payments.test.ts`) |
| 2   | Amount changed after the payment link              | The intent's amount is the quoted fare (fixed at the quote, no surge); `IntentsService.markPaid` is the only place an intent becomes paid                                                                                               | ok                      |
| 3   | Float money, client-trusted prices                 | Integer so'm; fares computed server-side from the stored quote; seat prices fixed on the trip; the client sends ids and choices only                                                                                                    | ok                      |
| 4   | Double credits (operator double click)             | A cash top-up or adjustment identical to one the same operator recorded within a minute is refused (409)                                                                                                                                | fixed (`audit.test.ts`) |
| 5   | Non-revenue money mixed with revenue               | Ledger kinds keep fares owed (`card_fare`), payouts, fees and tax apart; one charge of each kind per ride/booking (unique indexes); the ledger is append-only (trigger + grants)                                                        | ok                      |
| 6   | Snapshots blocking recovery                        | Rides keep their tariff snapshot (waiting, cancellation); receipts re-read the ride, not the tariff                                                                                                                                     | ok                      |

## Time zones and day boundaries

| #   | Bug class                            | SFF Taxi                                                                                                                                                                                                                                                       | Status                     |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 7   | UTC day boundary                     | Tashkent day/week/month helpers (range predicates) for caps, tax periods, earnings                                                                                                                                                                             | ok                         |
| 7b  | Tests depending on the hour and date | Night add-on (23:00–06:00), commission caps and the promo end read an injectable **business calendar**; tests pin it to a daytime date (`TEST_CALENDAR_AT`, refused in production) and cover 22:59/23:00/05:59/06:00, Monday midnight, month change, promo end | fixed (`calendar.test.ts`) |
| 8   | Business dates rendered in UTC       | The API returns ISO timestamps; SMS texts format Tashkent time                                                                                                                                                                                                 | ok                         |
| 9   | Time-based state with no enforcer    | Worker jobs: dispatch timeouts, unpaid card rides and top-ups (housekeeping), abandoned uploads; quotes and offers carry deadlines checked at use                                                                                                              | ok                         |

## Idempotency, races and duplicates

| #   | Bug class                                 | SFF Taxi                                                                                                                                                                                    | Status                                                  |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 10  | Double submits                            | Rider orders and seat bookings: `clientRequestId` + unique index + advisory lock; phone orders and phone seat bookings: the panel's `clientRequestId` per operator (201 then 200)           | ok / fixed (`rider-operator-gaps`, `wave3-panel-rider`) |
| 11  | Single-use tokens consumed non-atomically | SSE tickets `GETDEL`; OTP rows locked                                                                                                                                                       | ok                                                      |
| 12  | Double claims                             | Offers: ride → offer → driver locked in one order, exactly one accept wins; seats counted under the trip lock with DB checks (never oversold, front seat once)                              | ok (`dispatch.test.ts`, `intercity.test.ts`)            |
| 13  | DB errors as 500                          | 23505/23503/23514/23P01/22P02 → 4xx; deadlock, serialization failure, **lock timeout** → 409 "try again"; statement timeout and **pool timeout** → 503                                      | fixed (`audit-infra.test.ts`)                           |
| 14  | Uniqueness left to the client             | Partial unique indexes: one open ride per rider (awaiting payment included), one active ride per driver, one pending offer per driver, one live booking per rider per trip, one open appeal | ok                                                      |
| 15  | Duplicate side effects                    | Outbox events in the change's transaction; notifications dedupe per (event, recipient, channel). The dispatcher ran 50 events in one transaction: a crash replayed the batch                | fixed (per-event claims; `audit.test.ts`)               |
| 16  | Retried non-idempotent POSTs              | No retry wrappers; the fiscal receipt number is stable across retries                                                                                                                       | ok                                                      |
| 17  | Refresh-token stampede                    | Reuse detection stays strict: the apps must refresh one at a time                                                                                                                           | open (apps)                                             |

## Offline, realtime

| #   | Bug class                     | SFF Taxi                                                                                                | Status |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| 18  | SSE listener leaks and errors | Nudges only, single-use 60 s tickets, 25 s ping, 10 streams per user; responses had no `error` listener | fixed  |
| 19  | TTLs shorter than app switch  | Payment window 10 min (+5 min while paying), OTP 5 min, upload URLs 10 min, read URLs 15 min            | ok     |

## Performance and limits

| #   | Bug class                         | SFF Taxi                                                                                                                                                                                                                     | Status                  |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 23  | Global middleware side effects    | Global: auth guard, metrics, rate-limit interceptor (only routes that opt in)                                                                                                                                                | ok                      |
| 24  | N+1                               | Lists use joins/subqueries; the operators' driver list computes balances in SQL                                                                                                                                              | ok                      |
| 26  | No limits on public/costly routes | Only OTP, geocoding and share links were limited. Now: verify, refresh, tariffs, geo cities/resolve, config, quotes, orders, stream tickets, uploads, top-ups, trip search/booking, complaints. Provider callbacks unlimited | fixed (`audit.test.ts`) |
| 26b | Brute force across new codes      | Wrong OTP codes counted per phone across new codes (the fixed-code store-review phones had unlimited guesses)                                                                                                                | fixed (`audit.test.ts`) |
| 27  | Unbounded waits                   | Statement timeout existed; pool, lock and idle-in-transaction waits were unbounded: `DB_CONNECT_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`                                                       | fixed                   |
| 27b | LIKE wildcards from users         | `%` and `_` typed in operator searches matched everything                                                                                                                                                                    | fixed (`audit.test.ts`) |

## Workers, retries, crash loops

| #   | Bug class             | SFF Taxi                                                                                                                                                | Status                        |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 28  | Poison pills          | Attempts were counted after the handlers. Now counted at the claim with a 2-minute lease; 10 attempts, then dead, listed and retryable (`admin/outbox`) | fixed (`audit.test.ts`)       |
| 28b | App vs database clock | Due events were compared with the app's clock but scheduled with the database's: a skewed host skipped them. Claims and backoff now use `now()` in SQL  | fixed                         |
| 29  | Dead schedules        | Handlers and jobs are Nest providers wired in the worker module: a missing one fails the boot                                                           | ok (`worker.test.ts`)         |
| 30  | Redis eviction        | Every key has a TTL; production Redis `noeviction` with memory alerts                                                                                   | ok (deploy)                   |
| 31  | Process-wide crashes  | The pg pool had no `error` listener: a Postgres restart would kill the API and worker                                                                   | fixed (`audit-infra.test.ts`) |
| 32  | Cold-start paths      | Tests build the whole app from migrations every run; the production compose was rehearsed                                                               | ok                            |

## Auth and security

| #   | Bug class                     | SFF Taxi                                                                                                                                       | Status                        |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 36  | Throttles bypassed by tokens  | OTP limits key on phone and IP; route limits on the user when signed in, else the IP                                                           | ok                            |
| 37  | Stale permissions             | Status and operator rights re-read on every request; blocking ends the shift and withdraws offers; an invalid licence takes the driver offline | ok                            |
| 38  | IDOR                          | Rider routes scope by rider, driver routes by driver, uploads by owner (operators read), bookings by rider, complaints by rider                | ok                            |
| 39  | Unbounded input               | zod limits and DB checks on all text; uploads size-limited per purpose and signed (type and length)                                            | ok                            |
| 40  | Secrets in the repo           | Env only; dev credentials only in `docker-compose.yml` / `infra`                                                                               | ok                            |
| 41  | Secrets in logs               | Authorization (bearer and Payme's Basic) and cookies were redacted; share-trip tokens, stream tickets and phones in URLs were logged           | fixed (`audit-infra.test.ts`) |
| 41b | Personal data in public files | Driver documents in a private bucket, presigned reads for the owner, operators and (face and car only) the ride's rider                        | ok (`uploads.test.ts`)        |
| 42  | Silent backlog                | Worker metrics: pending, oldest pending age, dead; alerts `OutboxBacklog`, `OutboxStale`, `OutboxDeadEvents`                                   | fixed                         |
| E1  | `.partial()` default traps    | Every `.partial()` checked: the vehicle PATCH has no defaults; the places PATCH is built without defaults (tested)                             | ok                            |
| E2  | Metrics open in production    | `METRICS_TOKEN` required in production; Caddy answers 404 from outside                                                                         | fixed                         |

## Deploy and migrations

| #   | Bug class                                | SFF Taxi                                                                                                                                | Status                                                       |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 43  | Parallel migrators, unbounded lock waits | One advisory-locked runner with checksums; it set no `lock_timeout`: an ALTER waiting behind a long transaction would stall every query | fixed (`SET LOCAL lock_timeout` 10 s; `audit-infra.test.ts`) |
| 44  | Deploy hygiene                           | One-shot migrate before the API, rolling API update with health checks, rollback by tags (rehearsed)                                    | fixed (deploy)                                               |
| 45  | Schema drift                             | `schema.ts` by hand next to migrations; tests on a database rebuilt from migrations                                                     | ok                                                           |
| 46  | Tests hitting production                 | Test setup refuses any database not named `taxi_test*`                                                                                  | ok                                                           |

## Open items

- **Refresh stampede (17)**: the apps must single-flight refreshes.
- **Collecting owed fees**: cash rides' cancellation fees are collected by the rider's next cash
  ride (a separate quote line, once per ride in the ledger, waivable; `wave3-driver-fees.test.ts`).
  Late seat cancellations are recorded only; card riders' fees are not kept from refunds.
- **Load test**: run on 2026-09-27 and again for wave 4 on 2026-09-30 (below); re-run after
  changes to dispatch, lists or the ledger, and with 2 API replicas on the production host
  (not a shared laptop) before launch.

## Load test (2026-09-27)

A throwaway database seeded by `apps/api/scripts/loadtest/seed.ts`: 2 000 active drivers and
50 000 riders in Guliston, 500 000 rides over 180 days (85% completed), 1.45 M ride events,
450 000 offers, 425 000 tax ledger entries and withholdings, 127 000 ratings. One API process
(:3270, `DB_POOL_MAX=10`) and one worker (:3271, dispatch tick 1 s) on the development laptop
(Windows, Postgres 17 and Redis in Docker), driven by `apps/api/scripts/loadtest/run.mjs`:
300 drivers online sending a GPS fix every 4 s for the whole run (75 fixes/s), drivers hearing
offers from the realtime channel (as the app's stream) and accepting through the API.

| Scenario (ms)                                  | Load                       | Before p50 / p95 | After p50 / p95 |
| ---------------------------------------------- | -------------------------- | ---------------- | --------------- |
| `POST rides/quote`                             | 20 concurrent, ~310 req/s  | 67 / 102         | 61 / 88         |
| `POST driver/location` (all phases)            | 75 fixes/s in background   | 22 / 143         | 35 / 124        |
| `GET admin/dispatch/live`                      | 5 concurrent               | 24 / 35          | 39 / 60 ¹       |
| `GET admin/rides?status=open`                  | 5 concurrent               | 5 / 9            | 5 / 9           |
| `GET admin/rides?status=all`                   | 5 concurrent               | 58 / 86          | 49 / 77         |
| `GET admin/rides` completed, one month         | 5 concurrent               | **542 / 599**    | 46 / 73         |
| `GET admin/rides` by driver                    | 5 concurrent               | 52 / 81          | 39 / 60         |
| `GET admin/rides?q=` phone fragment            | 5 concurrent               | **406 / 793** ²  | 25 / 42         |
| `GET admin/drivers` (balances, card owed)      | 3 concurrent               | 54 / 85          | 20 / 34         |
| `POST rides` (order, busy)                     | 20 rider flows, 4 orders/s | 25 / 85          | 20 / 79         |
| `POST driver/offers/:id/accept`                | same                       | 21 / 38          | 19 / 34         |
| `complete` (charges, receipt event)            | same                       | 23 / 43          | 24 / 43         |
| order → first offer (dispatch)                 | same                       | —                | 390 / 844       |
| order → assigned (incl. ~2.5 s driver reading) | same                       | 3 728 / 4 863    | 3 029 / 4 117   |

¹ Measured with 553 drivers online (the first run left its 300 on shift). ² p99 4.5 s.
"Before" is a shorter first run (5-8 s phases, 15 s cycle), "after" 20 s phases and a 60 s
cycle (241 orders, all assigned; no 5xx, no outbox backlog, no errors in the logs).

Fixes (`migrations/0014_load_test_indexes.sql` and `rides.service.ts`):

- **Rides by day** scanned the primary key backwards through every newer ride (74 000 rows
  filtered for one month, 250 ms in SQL): ids are time-ordered, so the day filter also bounds
  the id (a ride's id is never later than its request, and at most ~a day earlier for rides for
  later and card rides): 250 ms → under 1 ms in SQL.
- **Phone search** (`%4521%`) read all 500 000 rides: a `pg_trgm` GIN index (129 ms → 0.8 ms).
- **Balances** (dispatch eligibility, the driver list, card money owed) summed ~250 ledger rows
  per driver from the heap: a covering index `(driver_id, kind) INCLUDE (amount)` makes it an
  index-only scan (driver list 54 → 20 ms).
- **Lists** no longer load the 2 KB tariff snapshot of every ride (views of one ride still do).

Next when the fleet grows: dispatch eligibility sums every in-radius driver's ledger before the
nearest ten are taken (18 ms with 553 online); above ~1 000 online drivers keep a running
balance per driver (trigger-maintained) instead. The API is CPU-bound near 300 quotes/s per
process: the production profile runs two replicas.

## Load test (wave 4, 2026-09-30)

Same database volumes and processes as above (a new throwaway database `taxi_load_w4`, seeded
with the same volumes, dropped afterwards), `run.mjs` with the baseline parameters, then with
`LOAD_WAVE4=1 LOAD_TRIP_S=30`: 60 of the 300 online drivers take shared rides
(`PUT driver/preferences {poolEnabled}`), 20 of them heading ~4 km east; 30% of the orders
agree to share (`shareable: true`, most going the same way), one driver in ten is a verified
woman, 45% of the riders are women (a few women-only orders). Drivers follow their stop list
(`GET driver/rides/current`, every 2 s on a trip), send the start code (it is night: every
ride has one) and keep taking offers on their way; a trip lasts 30 s.

**The laptop was shared** (other checkouts running tests and servers, CPU at 85-100%, commits
up to 300 ms): latencies are noisier and higher than on 2026-09-27 for code that did not
change. Before and after were therefore run alternately (6 wave 4 runs each, 2 baseline runs
each; medians below), and the fixes are judged by work that does not depend on the neighbours:
the dispatcher's tick (`dispatch_tick_seconds`, new on the worker's `/metrics`), database
blocks per quote and per order (`pg_stat_database`) and `EXPLAIN ANALYZE` of the compiled
queries.

| Scenario (ms, p50 / p95)                              | 2026-09-27      | Baseline run, wave 4 code | Wave 4, before      | Wave 4, after      |
| ----------------------------------------------------- | --------------- | ------------------------- | ------------------- | ------------------ |
| `POST rides/quote` (+ pool preview, women drivers)    | 61 / 88         | 107 / 194                 | 98 / 182            | 105 / 173          |
| `POST rides/quote` during the order cycle             | —               | 22 / 155                  | 34 / 149            | 22 / 128           |
| `POST driver/location` (all phases)                   | 35 / 124        | 46 / 230                  | 52 / 207            | 49 / 225           |
| `GET admin/dispatch/live`                             | 39 / 60         | 39 / 75                   | 33 / 62             | 36 / 66            |
| `GET admin/rides` (open / all / month / driver / `q`) | 5 / 9 … 25 / 42 | 9 / 21 … 41 / 86          | 7 / 16 … 38 / 74    | 8 / 18 … 38 / 81   |
| `GET admin/drivers`                                   | 20 / 34         | 31 / 60                   | 27 / 48             | 26 / 46            |
| `POST rides` (order)                                  | 20 / 79         | 26 / 175                  | 29 / 138            | 30 / 129           |
| `GET driver/offers`                                   | —               | —                         | 5 / 17              | 5 / 17             |
| `POST driver/offers/:id/accept` (a free car)          | 19 / 34         | 33 / 121                  | 36 / 172            | 37 / 140           |
| ... a car heading somewhere (along)                   | —               | —                         | 44 / 88 (19)        | 44 / 116 (31)      |
| ... joining a car with riders (join)                  | —               | —                         | 63 / 88 (17)        | 89 / 125 (28)      |
| `GET driver/rides/current`                            | —               | —                         | 15 / 109            | 10 / 77            |
| ... with `pool.stops` (2-3 riders)                    | —               | —                         | 20 / 97             | 14 / 101           |
| `complete`                                            | 24 / 43         | 31 / 97                   | 32 / 124            | 31 / 119           |
| order → first offer                                   | 390 / 844       | 457 / 1 319               | 596 / 1 637         | 520 / 1 472        |
| ... shareable orders                                  | —               | —                         | 584 / 1 436         | 492 / 1 342        |
| order → assigned (incl. ~2.5 s the driver reads)      | 3 029 / 4 117   | 3 434 / 4 538             | 3 514 / 4 739       | 3 457 / 4 655      |
| **dispatch tick** during the order cycle (mean)       | —               | 89 / 326                  | **134 / 465 (152)** | **75 / 373 (100)** |
| database blocks per quote / per order                 | —               | —                         | 605 / 8 990         | 455 / 7 017        |

Numbers in brackets: samples (joins are few: random trips rarely fit another car's way; 45
joins and 50 other accepts on the way in 12 runs; the join path did not change, its
p50 moves with so few samples). About 2 orders per run found no driver
within 45 s, before and after alike (not investigated further). No 5xx in any run; three 409s
(an offer on the way that was no longer valid).

What the profile and the plans showed, and the fixes (`3f1f704`, behaviour unchanged, API
suite green):

- **Eligibility summed the ledger of every driver in the radius** before taking the nearest
  ten (217 sums of ~250 rows for one ride; the note above predicted it), now for every rank
  twice (free cars, then cars on their way). The candidate list is now built without the
  balance and fenced (`OFFSET 0`); the balance is summed in the outer query, row by row in
  distance order, only until the limit is reached; the row is locked there (skip locked, as
  before) and online/fresh/in-radius are checked again on it. Compiled query: free cars 18.7 →
  3.8 ms, cars on their way 1.5 → 0.7 ms. This is the tick's halving.
- **N+1 in `rank()`**: each car on its way cost 2-3 queries in the transaction, one after the
  other (up to 6 cars), and its route check after that. `PoolService.cars()` loads them in 3
  queries; their routing matrices run at once (at most 6: bounded). Billing and pool rules are
  read once per rank instead of four times (still inside the transaction).
- **Quotes**: owed fees, free cars, shared cars and women drivers were awaited one after the
  other; now in parallel. The preview's cars are loaded in one batch. The quote's API CPU is
  ~5 ms either way (spread over ~9 queries: Kysely building 15%, sockets 7%, no single hot
  spot); caching the preview per rider was not needed.
- **`driver/rides/current`** loaded the car twice (for the next stop and for the stop list).
- **Indexes** (`migrations/0018_wave4_indexes.sql`): cars on their way are a few of the online
  drivers, but the planner expected one row and joined every vehicle per driver (19 ms with 300
  online); a partial index `WHERE is_online AND (pool_enabled OR destination_lat IS NOT NULL)`
  gives it the right plan (2 ms; the quote's preview uses it too). The quote's women-driver
  count scanned every registered driver: a partial index on online verified women
  (1.4 → 0.4 ms). No other new query needed one.

Next: the quote is now ~5 ms of API CPU (about 200 quotes/s per process on this laptop, 300 on
2026-09-27 with fewer reads); two replicas cover the launch. Above ~1 000 online drivers keep
the running balance per driver as noted above.
