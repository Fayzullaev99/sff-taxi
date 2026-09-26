# SFF Taxi backend: architecture and decisions

This explains how `apps/api` works and why it was built this way. Section references like
"MA §6.3" point to [market-analysis.md](market-analysis.md). The API is built on the core of the
sister project SFF Eats; see [conventions.md](conventions.md) for the engineering rules.

## 1. Processes and building blocks

```
 rider app ─┐                         ┌─> PostgreSQL 17 (all state, outbox, ledger)
 driver app ┼─ HTTPS ─> API (NestJS) ─┤
 op. panel ─┘   SSE  <──── Redis pub/sub <── worker (outbox dispatcher, dispatch loop)
                                      └─> Redis (rate limits, GPS trails, geocoder/route cache)
```

- **API** (`src/main.ts`): HTTP endpoints, SSE streams. Stateless; scale horizontally.
- **Worker** (`src/worker.ts`): the outbox dispatcher (realtime, push/SMS, dispatch reactions),
  the dispatch loop (`DISPATCH_TICK_MS`, default 1 s), health/metrics on `:3201`. Several workers
  may run: outbox rows are claimed with `FOR UPDATE SKIP LOCKED`, dispatch locks the ride rows.
- **Outbox**: every side effect (a push, an SSE nudge, the next dispatch step) is an event
  written in the same transaction as the change (`emit(trx, topic, payload)`), so it happens if
  and only if the change committed. Handlers are idempotent; deliveries are recorded per
  handler, so a failing handler is retried alone.
- **Copied from SFF Eats**: config validation, SQL migrations with checksums, SMS OTP auth with
  rotating refresh tokens and fixed codes for store reviewers, Redis rate limiter, SMS providers
  (Eskiz, Play Mobile, console), metrics, Sentry, the outbox, geo (Sirdaryo cities from OSM,
  Yandex/Nominatim geocoding, OSRM with fallback, the GPS quality filter), SSE with single-use
  tickets, Expo push.

## 2. Accounts and roles

One account per phone number (`users`). The same account can **ride** (every account),
**drive** (a row in `drivers`, usable once an operator approved it) and **dispatch** (a row in
`admins`, created on sign-in for phones in `ADMIN_PHONES`). Each app signs in with its own
session: `client` is `rider`, `driver` or `admin`; the operator panel refuses non-operators.
Status and rights are re-read on every request, so a block takes effect at once.

Phone orders create the caller's account on the spot (no session); when the caller later
installs the app and signs in with that phone, the ride is there.

## 3. Geography

`cities` holds the 11 Sirdaryo towns with OSM boundaries (Guliston active, the rest "coming
soon"; MA §5.1). A ride may start inside an active city or within its `service_radius_km`
(default 15 km) of the boundary: villages around Guliston are 57% of the region (MA §5.5).
Road distances come from OSRM (`ROUTER=osrm`); when the router is not configured, fails or is
slower than `ROUTER_TIMEOUT_MS`, the straight line × `ROUTER_DETOUR_FACTOR` (1.35) is used, so a
quote never waits on it. Boundaries are editable by operators (Guliston grew in Aug 2026, MA §5.1).

Driver GPS fixes pass the SFF Eats filter: reported accuracy ≤ 100 m, speed ≤ 150 km/h since the
last good fix (three consistent "jumps" re-anchor), and within 150 km of a city box (widened from
Eats' 20 km because intercity rides go to Tashkent). Good fixes update the driver row and a
20-point Redis trail used by the share link and the rider map.

## 4. Prices (MA §6.3)

Prices are **fixed at quote time and never surge** — the core brand promise ("Narx oldindan va
o'zgarmaydi", MA §6.2), also a regulatory comfort after the Competition Committee's warning to
Yandex about price dynamics (MA §1.9). The engine is `src/lib/tariff.ts` (pure, unit-tested).

| Part         | Rule                                                            | Default                                                             |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| In-city      | distance bands by road km                                       | ≤2 km 5 000; ≤4 km 7 000; ≤7 km 10 000; then +900/km                |
| Suburb       | the part of the route outside the city polygon, per started km  | 1 500/km                                                            |
| Intercity    | road distance ≥ 20 km: whole car per started km, minimum        | 1 700/km, min 25 000                                                |
| Seat share   | intercity, per seat (reference price for the coming trip board) | 30%, front +10%                                                     |
| Comfort      | own bands (~+25%, like Yandex Comfort over Start)               | 6 300 / 8 800 / 12 500, +1 100/km, 1 900/km out, 2 100/km intercity |
| Night        | 23:00–06:00 Tashkent, fixed add-on                              | +20%                                                                |
| Waiting      | after arrival: free minutes, then per started minute            | 2 min free, 500/min                                                 |
| Options      | flat; also filter which cars get the ride                       | child seat 2 000, luggage 2 000, pets 3 000, AC 0                   |
| Cancellation | rider cancels after arrival + free waiting, or no-show          | 3 000 (to the driver)                                               |

- The suburb part is estimated as the straight-line distance of each end from the polygon,
  stretched by the route's own detour ratio. It needs no road geometry and is explainable.
- A **quote** is stored with the fares of both classes and the tariff snapshot; the order
  references it, so the rider pays exactly what was shown, and the ride keeps its tariff's
  waiting and cancellation rules even if operators change the tariff meanwhile. Quotes live
  10 minutes.
- The global tariff is a validated setting; a city can override it entirely (`cities.tariff`).
- Rounding: totals up to 100 so'm (cash).

Deviations from the analysis, by decision: free waiting is 2 minutes (the analysis suggested 3;
2 matches Yandex and the product brief). Child-seat and luggage prices are hypotheses [H] to be
checked in the field survey (MA §7). "Luggage" requires a car marked `big_trunk` because many
Cobalts/Nexias carry a CNG tank in the trunk (MA §5.5).

## 5. Rides

```
searching ──> driver_assigned ──> driver_arrived ──> in_progress ──> completed
    │  ^              │  │               │
    │  └── driver drops (not a no-show) ─┘
    └──────────┴──────┴─> cancelled (rider · driver no-show · operator · system)
```

- **Ordering** is idempotent: the app sends a `clientRequestId`; a repeat returns the same ride
  (200 instead of 201). An advisory lock per rider serialises double taps.
- **Invariants in the database**, not only in code: a partial unique index allows one active
  ride per driver and one open ride per rider; a check requires a driver for every assigned or
  later state and a total for completed rides; offers allow one pending offer per driver.
- Every change writes a `ride_events` row (who, when, data) and an outbox event.
- **Cancellation**: the rider cancels free until the driver has arrived and the free waiting ran
  out; after that the tariff's fee is recorded (cash rides: owed, collection is future work). A
  driver may end the ride as a **no-show** only `no_show_after_minutes` (5) after arriving; it
  counts on the rider (`no_show_count`, shown to drivers). Any other driver cancellation sends
  the ride **back to dispatch** instead of cancelling it, and counts against the driver's
  reliability. Operators can cancel anything open, including a ride in progress.
- **Completion**: fare = quote + paid waiting. Cash is collected by the driver (`paid`); the
  ride's tax and commission are debited from the driver's balance in the same transaction.
- **Operators** order by phone for callers without the app (MA O1): the price is computed on the
  spot, the caller gets SMS updates with the car, plate and driver's number.

## 6. Dispatch (MA §6.4)

`src/modules/dispatch/dispatch.service.ts`, run by the worker's loop and by an outbox handler
(new ride, declined or withdrawn offer), so a decline moves on at once.

1. **Direct offers**: the best **road ETA** among the nearest free drivers (straight-line
   prefilter within 5 km, top 10 routed through OSRM's table service; the estimate at city speed
   when OSRM is down). Each offer waits **15 s**; up to **3** drivers, one at a time. If nobody
   free is near, the ride waits as long as those offers would have taken (45 s).
2. **Broadcast**: every free driver within **3 km** (except those who declined) sees the ride for
   30 s; the first to accept wins. Drivers coming free during that window are added.
3. **Operators**: when the broadcast times out, an attention alert (SSE + event) goes to the
   dispatchers, who can assign by hand from the ranked candidates; drivers coming free still see
   the ride. After 10 minutes of searching the system cancels it and tells the rider.

**Who is eligible**: online, active, a GPS fix younger than 2 minutes, balance at or above the
minimum, no active ride, no other pending offer, not the rider themself, not a driver who
dropped this ride, a comfort car for comfort rides, the car features the options need.

**Priority score** (0–100, `src/lib/priority.ts`), shown to drivers with its parts, like Yandex's
transparent priority in Uzbekistan (MA §1.5): 40% acceptance (accepted / received offers, prior
8 of 10), 30% reliability (1 − rides dropped after accepting / accepted, prior 10 clean rides),
30% rating (average stars with a prior of five 4.8-star ratings). A new driver starts at 91. The
score is **only a tie-breaker** between drivers whose ETAs are within 60 s of the best; the
nearest driver otherwise always gets the offer (MA §6.4: pure broadcast rewards tapping speed,
bidding stalls in a thin market).

**Never two drivers, never two rides**: dispatch holds the ride row (`FOR UPDATE SKIP LOCKED`, so
two workers never step on each other) and locks candidate drivers with `SKIP LOCKED`, so two
rides dispatched at once never pick the same driver. Accepting locks the ride first, then the
offer and the driver — the same order everywhere, so racing accepts serialise without
deadlocks: exactly one wins, the other gets 409. The unique indexes back all of it up.
Deadlocks or serialisation failures that still happen are answered 409 ("try again").

**Time control**: `tick(now)` and `processRide(id, now)` take the clock as a parameter; the
tests drive the whole cascade (15 s timeouts, broadcast window, operator alert, 10-minute
timeout) with simulated time and a fake OSRM that makes the nearest driver the slowest.

## 7. Drivers and regulation (MA §4)

| Rule (Res. 200 and related)                                             | Implementation                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Self-employed with a passenger-transport **licence card**               | card number and expiry required; no shift with an expired card; document photo required           |
| Age 21+, category B, 3+ years of experience (cl. 10)                    | checked on application and again on approval (`src/lib/driver-rules.ts`)                          |
| ≤ 4 passenger seats, city taxi ≤ 15 years old, no van type (Damas/Labo) | checked on application and approval; seats also a DB check                                        |
| Aggregator serves only licensed carriers, joint liability               | operators approve only complete, valid applications; blocking ends the shift and withdraws offers |
| 1% turnover tax withheld by the aggregator (PP-247)                     | `tax_withholdings` row per ride with PINFL, month report, remittance record                       |
| Personal data of UZ citizens stored in UZ                               | deployment requirement (UZ data centre) — see next steps                                          |

Statuses: `pending → active | rejected`, `active ⇄ blocked`, `rejected → pending` on
re-application. Every decision carries a reason the driver sees, in `driver_status_changes` —
the "transparent rules, human appeal" differentiator against opaque account blocks (MA §1.5, §6.1).

Plates are validated in both current formats (`20 A 123 BC`, `20 123 ABC`) with real region
codes; licence numbers as two letters + seven digits. The licence card number format is not
public, so it is only sanity-checked; verifying it against the Ministry of Transport is item A5.

## 8. Money (MA §6.3 "Driver fee model")

- **Cash first** (63% of legal taxi turnover in 2026, MA §5.5). Card payment is a hook
  (`PaymentsService`, `CardGateway`); until a gateway is configured, orders with `card` are refused.
- **Driver balance** is an append-only ledger: a trigger refuses updates and deletes, and the
  runtime role has no UPDATE/DELETE on the table. Balance = sum of entries. Entries: `topup`
  (cash at the office now, Payme/Click later), `commission`, `tax`, `pass`, `adjustment` (with a
  note). A ride is charged each kind at most once (unique index), so retries cannot double-charge.
- **Commission**: 0% during the launch promo (`promo_until`, default 2026-12-31 ≈ 3 months);
  then 5% of city rides capped at 10 000 per Tashkent day and 55 000 per week; intercity 5%
  capped at 10 000 per ride, outside the daily cap. **Passes** (day 9 000, week 50 000) replace
  city commission; bought back to back from the balance.
- **Minimum balance** (default −10 000): below it a driver cannot start a shift nor get offers.
- **Earnings**: per day/week, fares, cash collected, commission, tax, net.

## 9. Safety

- **Ratings** both ways, once per side per completed ride, within 7 days; driver stars feed the
  priority score; rider rating and no-shows are shown to drivers.
- **SOS** from the rider or the driver (until an hour after the ride): logged with the position,
  realtime alert and SMS to operators, emergency numbers (112/102/103/101) in the answer.
- **Share trip**: an unguessable token link shows the car, the driver's first name and the live
  position with its trail; no phone numbers; it stops working when the ride ends.

## 10. Realtime and notifications

SSE events are nudges (refetch the resource), never more than the recipient may read; the only
payload with data is the driver's position, sent to the rider of that ride straight from the
location endpoint (no outbox, it is ephemeral). Push (Expo) and SMS are sent by the worker from
outbox events and logged per (event, recipient, channel), so retries never send twice; a push
outage retries the event; dead tokens are removed. Offers are pushed as urgent messages that
expire with the offer.

## 11. What is not built yet (next steps)

For the apps and panel agents:

- **Rider app**: sign-in, map with `/geo/config`, address search, quote → order (keep the
  `clientRequestId` per attempt), SSE for status and the car's position, cancel (show
  `cancelFeeNow`), rating, SOS, share link, push token registration.
- **Driver app**: application + document photos (URLs now; upload to S3 like SFF Eats' uploads
  module is the next API task), shift, background GPS every 3–5 s, offers with a 15 s countdown
  (SSE `offer.new` + urgent push), ride steps, cancel reasons, balance/passes/earnings, priority
  score screen, SOS.
- **Operator panel**: live map (`/admin/dispatch/live`), phone-order form with quote, ride list
  and detail with offers/events, manual assignment from candidates, driver verification queue,
  tariff/dispatch/billing settings and city editor, tax report, SOS queue — all SSE-driven.

Backend backlog, by market-analysis priority:

- **Intercity trip board** (MA §6.4, R6/D4/O6): drivers publish departures, riders book seats
  (the seat price is already in every intercity quote). Legal check of the Tashkent route first (MA §4).
- **Fiscal receipts** through the tax authority's OFD integration (A4) and **licence
  verification** with the Ministry of Transport (A5): legally required before launch.
- Card payments (Payme/Click acquiring, driver top-ups), collecting owed cancellation fees,
  masked calls, scheduled rides, promo codes, the shared driver pool with SFF Eats (A9).
- Deployment in a UZ data centre (personal-data law, MA §4), copying SFF Eats' Docker/Caddy setup.
