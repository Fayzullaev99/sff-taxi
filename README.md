# SFF Taxi

Ride-hailing for Guliston (Sirdaryo region, Uzbekistan) and nearby towns: fixed prices without
surge, cash first, phone orders through operators, a low capped driver fee, and the licence and
tax rules of Cabinet Resolution No. 200 built in.

- Market and product analysis: [docs/market-analysis.md](docs/market-analysis.md)
- How the backend works and why: [docs/architecture.md](docs/architecture.md)
- Engineering conventions (read before changing code): [docs/conventions.md](docs/conventions.md)

## Repository

| Path          | What                                                  |
| ------------- | ----------------------------------------------------- |
| `apps/api`    | NestJS 12 API + worker (Kysely, PostgreSQL 17, Redis) |
| `apps/rider`  | Rider app (Expo) — planned                            |
| `apps/driver` | Driver app (Expo) — planned                           |
| `apps/web`    | Operator / dispatcher panel (React) — planned         |
| `infra`       | Local Postgres init (roles, test databases)           |
| `docs`        | Market analysis, architecture, conventions            |

The API reuses the production-tested core of the sister project SFF Eats (auth, outbox, geo,
realtime, notifications, observability), adapted for rides.

## Local development

Requirements: Node 24+, Docker.

```bash
npm install
npm run infra:up                       # Postgres :5460, Redis :6394 (docker compose)
cp apps/api/.env.example apps/api/.env # then set JWT_ACCESS_SECRET and ADMIN_PHONES
npm run db:migrate
npm run dev                            # API on http://localhost:3200
npm run dev:worker                     # worker: outbox, dispatch loop; health on :3201
```

With `SMS_PROVIDER=console` the sign-in codes are printed in the API log. The phone in
`ADMIN_PHONES` becomes an operator (dispatcher) on sign-in with `client: "admin"`.

Tests (real Postgres and Redis, the whole HTTP pipeline; the test database `taxi_test` is
rebuilt from the migrations on every run):

```bash
npm run typecheck
rtk proxy npx eslint .
npx prettier --check .
cd apps/api && rtk proxy npx vitest run --reporter=default
```

Production build: `npm run build -w apps/api`, then `node dist/main.js` (API) and
`node dist/worker.js` (worker); migrations with `npm run db:migrate -w apps/api` using
`DATABASE_MIGRATION_URL` (the schema owner). All settings are environment variables, documented
in [apps/api/.env.example](apps/api/.env.example) and validated at start
([src/config/env.ts](apps/api/src/config/env.ts)).

## API

Base path `/v1` (health and metrics are at the root). JSON, bearer access tokens
(`Authorization: Bearer …`), errors `{ statusCode, message, issues? }` with Uzbek messages.
Money is whole so'm; times are ISO 8601 UTC.

### Accounts

| Method | Path              | Who    | What                                                               |
| ------ | ----------------- | ------ | ------------------------------------------------------------------ |
| POST   | `/auth/code`      | public | Send an SMS code to `{ phone }` (1/min, 6/h per phone)             |
| POST   | `/auth/verify`    | public | `{ phone, code, client: rider\|driver\|admin }` → access + refresh |
| POST   | `/auth/refresh`   | public | Rotate the refresh token (reuse revokes the family)                |
| POST   | `/auth/logout`    | public | Revoke the session                                                 |
| GET    | `/me`             | any    | Account, `isAdmin`, `driver` status (null if not a driver)         |
| PATCH  | `/me`             | any    | `{ fullName }`                                                     |
| PUT    | `/devices`        | any    | Register an Expo push token `{ token, app, platform, locale }`     |
| DELETE | `/devices/:token` | any    | Unregister on sign-out                                             |

### Map and prices

| Method | Path           | Who    | What                                                           |
| ------ | -------------- | ------ | -------------------------------------------------------------- |
| GET    | `/geo/cities`  | public | Service areas (Guliston active, 10 towns upcoming)             |
| GET    | `/geo/resolve` | public | `?lat&lng` → inside / upcoming / outside with the nearest city |
| GET    | `/geo/search`  | public | Address suggestions `?q&lat&lng&lang` (Yandex → Nominatim)     |
| GET    | `/geo/reverse` | public | Address at a map pin                                           |
| GET    | `/geo/config`  | public | Map provider, tiles, default view, city polygons               |
| GET    | `/tariffs`     | public | `?lat&lng` → the published tariff where a ride would start     |

### Rider

| Method | Path                | What                                                                                                                                         |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/rides/quote`      | `{ pickup, dropoff, options }` → fixed fares for economy and comfort (valid 10 min)                                                          |
| POST   | `/rides`            | `{ quoteId, class, paymentMethod, pickup{address,landmark}, dropoff, comment, clientRequestId }` → 201 (200 on a repeated `clientRequestId`) |
| GET    | `/rides/current`    | The open ride or `null`                                                                                                                      |
| GET    | `/rides`            | History (`?cursor`)                                                                                                                          |
| GET    | `/rides/:id`        | Ride with driver, car, live position, timeline, `cancelFeeNow`                                                                               |
| POST   | `/rides/:id/cancel` | Free until the driver waited the free minutes, then the fee                                                                                  |
| POST   | `/rides/:id/share`  | Share-trip link `{ token, url }`                                                                                                             |
| POST   | `/rides/:id/rating` | `{ stars, tags, comment }` after completion                                                                                                  |
| POST   | `/rides/:id/sos`    | `{ lat, lng, note }` → operators alerted, emergency numbers returned                                                                         |
| GET    | `/share/:token`     | Public: car, driver's first name, live position and trail (410 after the ride)                                                               |

### Driver

| Method | Path                                    | What                                                                                                                              |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/driver/application`                   | Personal data, licence, licence card, PINFL, car (Res. 200 rules)                                                                 |
| PUT    | `/driver/documents/:kind`               | Document photo URL (`licence_card`, `driver_licence`, `passport`, `vehicle_registration`, `insurance`, `vehicle_photo`, `selfie`) |
| GET    | `/driver/me`                            | Status and reason, car, documents, priority score, balance, blockers                                                              |
| POST   | `/driver/shift`                         | `{ online }` (needs active status, valid licence card, balance ≥ minimum)                                                         |
| POST   | `/driver/location`                      | GPS fix `{ lat, lng, accuracy, heading, speed }` (filtered)                                                                       |
| GET    | `/driver/offers`                        | Offers waiting for an answer                                                                                                      |
| POST   | `/driver/offers/:id/accept`             | Take the ride (exactly one driver wins)                                                                                           |
| POST   | `/driver/offers/:id/decline`            | Pass; the next driver is asked at once                                                                                            |
| GET    | `/driver/rides/current`                 | The ride in progress or `null`                                                                                                    |
| GET    | `/driver/rides`, `/driver/rides/:id`    | History with earnings; one ride                                                                                                   |
| POST   | `/driver/rides/:id/arrive`              | At the pickup: free waiting starts                                                                                                |
| POST   | `/driver/rides/:id/start`               | Rider on board: paid waiting fixed                                                                                                |
| POST   | `/driver/rides/:id/complete`            | Fare = quote + waiting; tax and commission debited                                                                                |
| POST   | `/driver/rides/:id/cancel`              | `{ reasonCode, note }`: `rider_no_show` (after waiting) ends the ride, other reasons send it back to dispatch                     |
| POST   | `/driver/rides/:id/rating`              | Rate the rider                                                                                                                    |
| POST   | `/driver/rides/:id/sos`                 | SOS from the driver                                                                                                               |
| GET    | `/driver/balance`                       | Balance, minimum, active pass, latest entries                                                                                     |
| GET    | `/driver/ledger`                        | Ledger entries (`?cursor`)                                                                                                        |
| GET    | `/driver/earnings`                      | `?period=day\|week`: rides, fares, cash, commission, tax, net                                                                     |
| GET    | `/driver/passes`, POST `/driver/passes` | Day / week pass bought from the balance                                                                                           |

### Operators (dispatch panel)

| Method    | Path                                                 | What                                                                                                                       |
| --------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| POST      | `/admin/rides/quote`                                 | Price a caller's trip                                                                                                      |
| POST      | `/admin/rides`                                       | Phone order for a caller `{ riderPhone, riderName, pickup, dropoff, class, options, comment }` (SMS updates to the caller) |
| GET       | `/admin/rides`                                       | Open rides (`?status=…&q=phone or number`)                                                                                 |
| GET       | `/admin/rides/:id`                                   | Full ride: offers, event history, earnings                                                                                 |
| POST      | `/admin/rides/:id/assign`                            | Manual assignment / reassignment `{ driverId }`                                                                            |
| POST      | `/admin/rides/:id/cancel`                            | `{ reason }`                                                                                                               |
| GET       | `/admin/dispatch/live`                               | Online drivers (free / offered / busy) and open rides                                                                      |
| GET       | `/admin/dispatch/rides/:id/candidates`               | Drivers ranked by road ETA for manual assignment                                                                           |
| GET       | `/admin/drivers`                                     | `?status&q` (name, phone, plate)                                                                                           |
| GET       | `/admin/drivers/:id`                                 | Everything to verify a driver, with status history                                                                         |
| POST      | `/admin/drivers/:id/approve\|reject\|block\|unblock` | `{ reason }` (required except approve)                                                                                     |
| PATCH     | `/admin/drivers/:id/vehicle`                         | Re-class the car, correct its features                                                                                     |
| GET/POST  | `/admin/billing/drivers/:id/ledger`                  | Ledger; cash top-up or signed adjustment with a note                                                                       |
| GET       | `/admin/billing/taxes`                               | `?period=YYYY-MM`: 1% tax withheld per driver                                                                              |
| POST      | `/admin/billing/taxes/remit`                         | Record the period's remittance `{ period, reference }`                                                                     |
| GET       | `/admin/sos`, POST `/admin/sos/:id/resolve`          | Open SOS events; close with a note                                                                                         |
| GET/PUT   | `/admin/settings/tariff\|dispatch\|billing`          | Platform rules (zod-validated)                                                                                             |
| GET/PATCH | `/admin/geo/cities[/:id]`                            | Cities: activation, boundary, own tariff                                                                                   |

### Realtime

`POST /stream/ticket` (authenticated) → single-use `ticket`; `GET /stream?ticket=…` opens a
server-sent-event stream. Events: `ride.updated {rideId, status}`, `driver.location` (to the
rider of the ride), `offer.new` / `offer.closed` (to the driver), `driver.updated`,
`ride.attention` and `sos` (operators). They are nudges: refetch the resource for details.

### Operations

`GET /health` (API: database and Redis), worker `GET :3201/health` and `/metrics`
(Prometheus; the API's `/metrics` honours `METRICS_TOKEN`). Errors go to Sentry when
`SENTRY_DSN` is set.
