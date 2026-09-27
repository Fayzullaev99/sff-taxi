# SFF Taxi

Ride-hailing for Guliston (Sirdaryo region, Uzbekistan) and nearby towns: fixed prices without
surge, cash first (card prepaid by Payme/Click), phone orders through operators, a low capped
driver fee, an intercity seat board, and the licence and tax rules of Cabinet Resolution No. 200
built in.

- Market and product analysis: [docs/market-analysis.md](docs/market-analysis.md)
- How the backend works and why: [docs/architecture.md](docs/architecture.md)
- Engineering conventions (read before changing code): [docs/conventions.md](docs/conventions.md)
- Card payments: [docs/payments.md](docs/payments.md); fiscal receipts and licence checks:
  [docs/fiscal-and-licence.md](docs/fiscal-and-licence.md)
- Production: [docs/deploy.md](docs/deploy.md), incidents: [docs/runbook.md](docs/runbook.md),
  audit checklist: [docs/audit.md](docs/audit.md)

## Repository

| Path          | What                                                            |
| ------------- | --------------------------------------------------------------- |
| `apps/api`    | NestJS 12 API + worker (Kysely, PostgreSQL 17, Redis)           |
| `apps/rider`  | Rider app (Expo), see apps/rider/README.md                      |
| `apps/driver` | Driver app (Expo), see apps/driver/README.md                    |
| `apps/web`    | Operator / dispatcher panel (React + Vite)                      |
| `infra`       | Local Postgres init (roles, test databases), SeaweedFS identity |
| `deploy`      | Production compose stack, Caddy, backups, monitoring            |
| `docs`        | Analysis, architecture, conventions, operations                 |

The API reuses the production-tested core of the sister project SFF Eats (auth, outbox, geo,
realtime, notifications, uploads, payments, observability, deployment), adapted for rides.

## Local development

Requirements: Node 24+, Docker.

```bash
npm install
npm run infra:up                       # Postgres :5460, Redis :6394, SeaweedFS (S3) :8335
cp apps/api/.env.example apps/api/.env # then set JWT_ACCESS_SECRET and ADMIN_PHONES
npm run db:migrate
npm run dev                            # API on http://localhost:3200
npm run dev:worker                     # worker: outbox, dispatch loop, jobs; health on :3201
```

With `SMS_PROVIDER=console` the sign-in codes are printed in the API log. The phone in
`ADMIN_PHONES` becomes an operator (dispatcher) on sign-in with `client: "admin"`.

Tests (real Postgres, Redis and SeaweedFS, the whole HTTP pipeline; the test database is rebuilt
from the migrations on every run; the business calendar is pinned to a daytime date so fares and
caps do not depend on when the suite runs):

```bash
npm run typecheck
rtk proxy npx eslint .
npx prettier --check .
cd apps/api && rtk proxy npx vitest run --reporter=default
# a second checkout: its own database and Redis index
TEST_DB_NAME=taxi_test_2 TEST_REDIS_DB=14 rtk proxy npx vitest run
```

Images: `npm run docker:build` (API/worker/migrations and the operator panel). Production:
[docs/deploy.md](docs/deploy.md). All settings are environment variables, documented in
[apps/api/.env.example](apps/api/.env.example) and validated at start
([src/config/env.ts](apps/api/src/config/env.ts)).

## API

Base path `/v1` (health and metrics are at the root). JSON, bearer access tokens
(`Authorization: Bearer …`), errors `{ statusCode, message, issues? }` with Uzbek messages;
429 `{ retryAfterSeconds }` on rate limits; 409 "qayta urinib ko‘ring" when two requests raced.
Money is whole so'm; times are ISO 8601 UTC.

### Accounts and configuration

| Method | Path                    | Who              | What                                                                                                                                                                                 |
| ------ | ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/auth/code`            | public           | Send an SMS code to `{ phone }` (1/min, 6/h per phone)                                                                                                                               |
| POST   | `/auth/verify`          | public           | `{ phone, code, client: rider\|driver\|admin }` → access + refresh (10 wrong codes/h lock)                                                                                           |
| POST   | `/auth/refresh`         | public           | Rotate the refresh token (reuse revokes the family: refresh one at a time)                                                                                                           |
| POST   | `/auth/logout`          | public           | Revoke the session                                                                                                                                                                   |
| GET    | `/me`, PATCH            | any              | Account, `isAdmin`, `driver` status; `{ fullName }`                                                                                                                                  |
| PUT    | `/devices`              | any              | Register an Expo push token `{ token, app, platform, locale }`; DELETE `/devices/:token`                                                                                             |
| GET    | `/config`               | public           | Support, minimum app versions (null = no forced update), `storeUrls`, feature flags (`scheduledPhoneOrders`, `owedCancellationFees`), card providers, `intercity` cancellation rules |
| GET    | `/uploads/config`       | any              | Whether uploads work, types and sizes per purpose                                                                                                                                    |
| POST   | `/uploads`              | any              | `{ purpose: document\|profile_photo\|vehicle_photo\|complaint_photo, contentType, sizeBytes }` → presigned PUT                                                                       |
| POST   | `/uploads/:id/complete` | owner            | After the PUT: size and file signature checked → `{ status: ready, url }` (presigned read)                                                                                           |
| GET    | `/uploads/:id`          | owner, operators | The file with a 15-minute read URL                                                                                                                                                   |

### Map and prices

| Method | Path           | Who    | What                                                               |
| ------ | -------------- | ------ | ------------------------------------------------------------------ |
| GET    | `/geo/cities`  | public | Service areas (Guliston active, 10 towns upcoming)                 |
| GET    | `/geo/resolve` | public | `?lat&lng` → inside / upcoming / outside with the nearest city     |
| GET    | `/geo/search`  | public | Address suggestions `?q&lat&lng&lang` (Yandex → Nominatim)         |
| GET    | `/geo/reverse` | public | Address at a map pin                                               |
| GET    | `/geo/config`  | public | Map provider, tiles, default view, city polygons                   |
| GET    | `/tariffs`     | public | `?lat&lng` → the published tariff, payment methods, card providers |

### Rider

| Method | Path                                         | What                                                                                                                                                                                                                                                                     |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/rides/quote`                               | `{ pickup, dropoff, options, scheduledFor? }` → fixed fares for economy and comfort (valid 10 min), `availability` (nearest free car per class, road ETA), `cardProviders`, `owedFee` (fees owed from cancelled cash rides: a separate line the next cash ride collects) |
| POST   | `/rides`                                     | `{ quoteId, class, paymentMethod: cash\|card, pickup{address,landmark}, dropoff, comment, clientRequestId }` → 201 (200 on a repeat). Card: `status: awaiting_payment` with `payment.checkout.{payme,click}`                                                             |
| GET    | `/rides/scheduled`                           | Rides ordered for later (`scheduled`, cash; the search starts 15 min before; up to 3)                                                                                                                                                                                    |
| GET    | `/rides/current`                             | The unfinished ride (awaiting payment included) or `null`                                                                                                                                                                                                                |
| GET    | `/rides`                                     | History (`?cursor`)                                                                                                                                                                                                                                                      |
| GET    | `/rides/:id`                                 | Ride with driver (photo), car (photo), `driverEta` (to the pickup), `destinationEta` (during the trip), `trail`, timeline, `rules`, `cancelFeeNow`, `fare.owedFee` / `fare.cancellationFeeStatus`, `payment`, `receipt`, `rated`                                         |
| POST   | `/rides/:id/cancel`                          | Free until the driver waited the free minutes, then the fee; a paid card ride is queued for a full refund                                                                                                                                                                |
| POST   | `/rides/:id/share`                           | Share-trip link `{ token, url }`                                                                                                                                                                                                                                         |
| POST   | `/rides/:id/rating`                          | `{ stars, tags, comment }` after completion                                                                                                                                                                                                                              |
| POST   | `/rides/:id/sos`                             | `{ lat, lng, note }` → operators alerted, emergency numbers returned                                                                                                                                                                                                     |
| POST   | `/rides/:id/complaints`                      | `{ type: lost_item\|driver_behaviour\|route\|price\|car_condition\|safety\|other, text, photoUploadIds? }` (7 days, up to 3 photos)                                                                                                                                      |
| GET    | `/complaints[/:id]`                          | The rider's complaints with the thread and `photos`; POST `/complaints/:id/messages` `{ text, photoUploadIds? }`                                                                                                                                                         |
| GET    | `/places`, POST, PATCH `/places/:id`, DELETE | Saved places: one home, one work, up to 20                                                                                                                                                                                                                               |
| GET    | `/places/recent`                             | Recent destinations from ride history (`key` each); POST `/places/recent/hide` `{ key }` or `{ lat, lng }` hides one until the next ride there; DELETE `/places/recent/hidden` shows all again                                                                           |
| GET    | `/share/:token`                              | Public: car, driver's first name, live position and trail (410 after the ride)                                                                                                                                                                                           |

### Intercity trip board

| Method | Path                                                                                                  | Who    | What                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/intercity/points`                                                                                   | any    | Towns (11 Sirdaryo towns, Tashkent) with meeting points                                                             |
| GET    | `/intercity/fares`                                                                                    | any    | `?from&to&class` (slug or id) → reference seat prices (rear, front) and the drivers' band                           |
| GET    | `/intercity/trips`                                                                                    | any    | `?from&to&date&seats` → open departures with free seats (no phone numbers)                                          |
| GET    | `/intercity/trips/:id`                                                                                | any    | A departure, `myBookingId`, `cancelRules` (free minutes, fee %, `freeUntil`)                                        |
| POST   | `/intercity/trips/:id/bookings`                                                                       | rider  | `{ seats, front, pickupNote, clientRequestId }` → 201 (200 on a repeat); never oversold                             |
| GET    | `/intercity/bookings[/:id]`                                                                           | rider  | Bookings; once booked: the driver's name and phone, the plate; `cancelFreeUntil`, `cancelFeeNow`                    |
| POST   | `/intercity/bookings/:id/cancel`                                                                      | rider  | Free until 60 min before departure, then a 30% fee is recorded                                                      |
| GET    | `/driver/intercity/fares`                                                                             | driver | Reference prices and the ±15% band for the car's class                                                              |
| POST   | `/driver/intercity/trips`                                                                             | driver | `{ from, to, departureAt, seats, frontSeat, priceRear?, meetingPoint?, comment? }`                                  |
| GET    | `/driver/intercity/trips[/:id]`                                                                       | driver | Trips by departure (`?scope=upcoming` soonest first; default latest first, paged) with the passenger list           |
| PATCH  | `/driver/intercity/trips/:id`                                                                         | driver | `{ departureAt?, seats?, frontSeat?, priceRear?, meetingPoint?, comment? }` until the first booking (409 after)     |
| POST   | `/driver/intercity/trips/:id/boarding`, `/bookings/:bookingId/board`, `/depart`, `/arrive`, `/cancel` | driver | Run the trip: boarding (1 h before), board, depart (the absent are no-shows), arrive (charges), cancel `{ reason }` |

### Driver

| Method | Path                                     | What                                                                                                                                                           |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/driver/application`                    | Personal data, licence, licence card, PINFL, car incl. `cngInTrunk` (Res. 200 rules); a new card is re-checked                                                 |
| PUT    | `/driver/documents/:kind`                | `{ uploadId, expiresOn }` (or a legacy `url`) for `licence_card`, `driver_licence`, `passport`, `vehicle_registration`, `insurance`, `vehicle_photo`, `selfie` |
| PUT    | `/driver/photo`, `/driver/vehicle/photo` | `{ uploadId }`: the face and the car riders see                                                                                                                |
| GET    | `/driver/me`                             | Status and reason, car, documents (read URLs, `contentType`), licence card verification, priority score, balance, blockers                                     |
| GET    | `/driver/config`                         | Commission, caps, passes, minimum balance, waiting/no-show rules, `intercity` timing rules, decline and cancel reasons, top-up limits, support                 |
| POST   | `/driver/appeals`, GET                   | `{ text }`: a rejected or blocked driver asks for a review (one open at a time)                                                                                |
| POST   | `/driver/shift`                          | `{ online }` (needs active status, a valid and verified licence card, balance ≥ minimum)                                                                       |
| POST   | `/driver/location`                       | GPS fix `{ lat, lng, accuracy, heading, speed }` (filtered)                                                                                                    |
| GET    | `/driver/offers`                         | Offers waiting for an answer (`ride.scheduledFor` for rides ordered for later, `ride.owedFee`)                                                                 |
| POST   | `/driver/offers/:id/accept`              | Take the ride (exactly one driver wins)                                                                                                                        |
| POST   | `/driver/offers/:id/decline`             | `{ reason }` (optional): pass; the next driver is asked at once                                                                                                |
| GET    | `/driver/rides/current`                  | The ride in progress or `null`; `collectCash` = what to take in cash (fare, waiting, owed fees)                                                                |
| GET    | `/driver/rides`, `/driver/rides/:id`     | History with earnings; one ride                                                                                                                                |
| POST   | `/driver/rides/:id/arrive`               | At the pickup: free waiting starts                                                                                                                             |
| POST   | `/driver/rides/:id/start`                | Rider on board: paid waiting fixed                                                                                                                             |
| POST   | `/driver/rides/:id/complete`             | Fare = quote + waiting; tax and commission debited; a card fare credited; the fiscal receipt queued                                                            |
| POST   | `/driver/rides/:id/cancel`               | `{ reasonCode, note }`: `rider_no_show` (after waiting) ends the ride, other reasons send it back to dispatch                                                  |
| POST   | `/driver/rides/:id/rating`, `/sos`       | Rate the rider; SOS                                                                                                                                            |
| GET    | `/driver/balance`, `/driver/ledger`      | Balance, minimum, active pass, entries (`topup`, `commission`, `tax`, `pass`, `adjustment`, `card_fare`, `payout`)                                             |
| GET    | `/driver/earnings`                       | `?period=day\|week`: rides, intercity bookings, fares, cash, commission, tax, net                                                                              |
| GET    | `/driver/passes`, POST `/driver/passes`  | Day / week pass bought from the balance                                                                                                                        |
| POST   | `/driver/topups`, GET `[/:id]`           | `{ amount }` (5 000..5 000 000) → Payme/Click checkout links; the balance grows once paid                                                                      |

### Operators (dispatch panel)

| Method    | Path                                                                                     | What                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST      | `/admin/rides/quote`                                                                     | Price a caller's trip                                                                                                                                                                      |
| POST      | `/admin/rides`                                                                           | Phone order `{ riderPhone, riderName, pickup, dropoff, class, options, comment, quoteId?, clientRequestId? }` → 201 / 200 on a repeat; a quote with `scheduledFor` orders a ride for later |
| POST      | `/admin/customers/lookup`                                                                | `{ phone }` → the caller's account, open ride, recent rides, recent and saved places, `owedFee`                                                                                            |
| GET       | `/admin/rides`                                                                           | `?status=open\|all\|…&q&driverId&riderId&class&from&to&cursor` (Tashkent days, 200 per page)                                                                                               |
| GET       | `/admin/rides/:id`                                                                       | Full ride: offers (`declineReasonLabel`), events (`reasonLabel`), earnings, `owedFees` (own, collects)                                                                                     |
| POST      | `/admin/rides/:id/assign`, `/cancel`, `/fee/waive`                                       | Manual assignment `{ driverId }`; cancel `{ reason }`; waive the ride's owed cancellation fee `{ note }`                                                                                   |
| GET       | `/admin/reasons`                                                                         | Decline / cancel / release reason codes with Uzbek labels                                                                                                                                  |
| GET       | `/admin/dispatch/live`, `/rides/:id/candidates`                                          | Online drivers and open rides; drivers ranked by road ETA                                                                                                                                  |
| GET       | `/admin/drivers`                                                                         | `?status&q`: with rating, priority, balance, `cardOwed`, licence status, position; `/admin/drivers/payouts`: card money owed per driver                                                    |
| GET       | `/admin/drivers/:id`, `/:id/rides`                                                       | Everything to verify a driver (documents with `contentType`, licence checks, history, `cardMoney`); the driver's rides                                                                     |
| POST      | `/admin/drivers/:id/licence`                                                             | `{ result: valid\|invalid, note, expiresOn }`: the registry check (approval needs valid)                                                                                                   |
| POST      | `/admin/drivers/:id/approve\|reject\|block\|unblock`                                     | `{ reason }` (required except approve)                                                                                                                                                     |
| PATCH     | `/admin/drivers/:id/vehicle`                                                             | `{ class, features, cngInTrunk }`                                                                                                                                                          |
| GET/POST  | `/admin/drivers/appeals`, `/appeals/:id/resolve`                                         | Appeals of rejected/blocked drivers; answer `{ resolution }`                                                                                                                               |
| GET/POST  | `/admin/billing/drivers/:id/ledger`                                                      | Ledger; cash top-up, signed adjustment with a note, payout of card money `{ kind: payout, amount, note }`                                                                                  |
| GET       | `/admin/billing/taxes`, POST `/taxes/remit`                                              | `?period=YYYY-MM`: 1% tax withheld per driver; record the remittance                                                                                                                       |
| GET       | `/admin/payments/refunds`, POST `/:id/refunded`                                          | Cancelled paid card rides to refund; record a Click/bank refund `{ reference }`                                                                                                            |
| GET       | `/admin/payments/intents[/summary]`                                                      | Card payments (rides, top-ups) `?purpose&status(…\|failed)&provider&driverId&rideId&phone&from&to&cursor`; totals                                                                          |
| GET       | `/admin/intercity/trips[/:id]`, `/search`                                                | The board (`?status&date&from&to`); a departure with bookings                                                                                                                              |
| POST      | `/admin/intercity/trips/:id/bookings`, `/cancel`; `/admin/intercity/bookings/:id/cancel` | Book seats for a caller `{ riderPhone, seats, front, pickupNote, clientRequestId? }` (SMS; 201 / 200 on a repeat); cancel trips and bookings                                               |
| GET/PUT   | `/admin/intercity/fares`                                                                 | Route seat prices `{ from, to, rear, front }` (null removes)                                                                                                                               |
| GET/POST  | `/admin/complaints[/:id]`, `/messages`, `/resolve`                                       | Complaints inbox; reply; resolve `{ resolution, note }`                                                                                                                                    |
| GET       | `/admin/ratings`                                                                         | `?of=driver\|rider&maxStars&subjectId&cursor`                                                                                                                                              |
| GET/POST  | `/admin/fiscal/receipts[/:id]`, `/receipts/resend`, `/receipts/:id/retry`                | Receipts with payloads; resend kept (`skipped`) or `pending` ones; retry one                                                                                                               |
| GET/POST  | `/admin/outbox`, `/admin/outbox/:id/retry`                                               | Dead or failing side effects; retry one                                                                                                                                                    |
| GET       | `/admin/sos`, POST `/admin/sos/:id/resolve`                                              | Open SOS events; close with a note                                                                                                                                                         |
| GET/PUT   | `/admin/settings/tariff\|dispatch\|billing\|intercity\|fiscal`                           | Platform rules (zod-validated)                                                                                                                                                             |
| GET/PATCH | `/admin/geo/cities[/:id]`                                                                | Cities: activation, boundary, own tariff                                                                                                                                                   |

### Payment providers (server to server)

`POST /payments/payme` (JSON-RPC, Basic auth with the cashbox key, account field `order_id`),
`POST /payments/click/prepare` and `/payments/click/complete` (signed form posts). See
[docs/payments.md](docs/payments.md).

### Realtime

`POST /stream/ticket` (authenticated) → single-use `ticket`; `GET /stream?ticket=…` opens a
server-sent-event stream. Events (nudges: refetch the resource):

- riders: `ride.updated {rideId, status}`, `driver.location {rideId, lat, lng, heading, at, etaS,
destinationEtaS}`, `ride.refund {rideId, status, amount}`, `intercity.updated {tripId,
bookingId, status}`, `complaint.updated`;
- drivers: `offer.new {offerId, rideId, driverId, expiresAt, scheduledFor}` / `offer.closed
{offerId, rideId, driverId, status}` (also when an operator assigns or cancels), `ride.updated`,
  `driver.updated {driverId, status}`, `topup.updated {intentId, status, amount}`,
  `appeal.updated {appealId, driverId, status}`, `intercity.updated`;
- operators: all ride and offer events, `ride.attention`, `sos`, `driver.appeal`,
  `drivers.positions {drivers: [{id, lat, lng, heading, at, busy}], offline: [id]}` every 5 s (an
  empty batch too when drivers left),
  `intercity.updated`, `complaint.updated`.

### Operations

`GET /health` (API: database and Redis), worker `GET :3201/health` and `/metrics`
(Prometheus; the API's `/metrics` needs `METRICS_TOKEN`). Errors go to Sentry when `SENTRY_DSN`
is set. Deployment, backups and incidents: [docs/deploy.md](docs/deploy.md),
[docs/runbook.md](docs/runbook.md).
