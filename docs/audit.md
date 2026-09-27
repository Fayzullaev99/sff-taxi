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
- **Load test**: not run for taxi yet; SFF Eats' numbers (same core) are in its checklist.
  Run one against a throwaway database before launch (quote, order, location updates, dispatch
  tick with 100 online drivers).
