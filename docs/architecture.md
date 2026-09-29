# SFF Taxi backend: architecture and decisions

This explains how `apps/api` works and why it was built this way. Section references like
"MA §6.3" point to [market-analysis.md](market-analysis.md). The API is built on the core of the
sister project SFF Eats; see [conventions.md](conventions.md) for the engineering rules.

## 1. Processes and building blocks

```
 rider app ─┐                         ┌─> PostgreSQL 17 (all state, outbox, ledger)
 driver app ┼─ HTTPS ─> API (NestJS) ─┼─> Redis (rate limits, GPS trails, ETAs, caches, pub/sub)
 op. panel ─┘   SSE  <──── Redis pub/sub <── worker (outbox, dispatch loop, jobs)
 apps ── presigned PUT/GET ──> S3 (SeaweedFS, private)     Payme/Click ──> API callbacks
```

- **API** (`src/main.ts`): HTTP endpoints, SSE streams. Stateless; scale horizontally.
- **Worker** (`src/worker.ts`): the outbox dispatcher (realtime, push/SMS, dispatch reactions,
  fiscal receipts, licence checks), the dispatch loop (`DISPATCH_TICK_MS`, default 1 s), the
  housekeeping job (unpaid card rides and top-ups, abandoned uploads; 30 s), the operators'
  positions batch (5 s), health/metrics on `:3201`. Several workers may run: outbox events are
  claimed one at a time with a 2-minute lease (`UPDATE … SKIP LOCKED`, the attempt counted at the
  claim, so a crashing event cannot loop), dispatch and jobs lock the rows they change.
- **Outbox**: every side effect (a push, an SSE nudge, the next dispatch step) is an event
  written in the same transaction as the change (`emit(trx, topic, payload)`), so it happens if
  and only if the change committed. Handlers are idempotent; deliveries are recorded per
  handler, so a failing handler is retried alone.
- **Copied from SFF Eats**: config validation, SQL migrations with checksums, SMS OTP auth with
  rotating refresh tokens and fixed codes for store reviewers, Redis rate limiter, SMS providers
  (Eskiz, Play Mobile, console), metrics, Sentry, the outbox, geo (Sirdaryo cities from OSM,
  Yandex/Nominatim geocoding, OSRM with fallback, the GPS quality filter), SSE with single-use
  tickets, Expo push, uploads (S3 presigned), Payme/Click, the Docker/Caddy deployment, and the
  lessons checklist ([audit.md](audit.md)).
- **Business calendar** (`src/core/clock/business-calendar.ts`): the night add-on, the Tashkent
  day/week/month of commission caps and tax periods and the promo end read the time through it.
  Real time in production; tests pin it (`TEST_CALENDAR_AT`) so the suite passes at any hour.
  Only the reading goes through it: stored timestamps and deadlines stay real (SQL `now()`).

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
(awaiting_payment, card rides) ──paid──> searching
(scheduled, rides for later) ──15 min before──> searching
searching ──> driver_assigned ──> driver_arrived ──> in_progress ──> completed
    │  ^              │  │               │
    │  └── driver drops (not a no-show) ─┘
    └──────────┴──────┴─> cancelled (rider · driver no-show · operator · system)
```

- **For later**: a quote with `scheduledFor` (30 minutes to 24 hours ahead) is priced at that
  time (night add-on) and ordered as `scheduled` (cash only for now, up to three per rider, not
  blocking a ride now); the dispatch loop starts its search 15 minutes before (a rider who is on
  another ride by then gets it cancelled with the reason). Riders cancel it free.
- **Ordering** is idempotent: the app sends a `clientRequestId`; a repeat returns the same ride
  (200 instead of 201). An advisory lock per rider serialises double taps.
- **Invariants in the database**, not only in code: a partial unique index allows one active
  ride per driver and one open ride per rider; a check requires a driver for every assigned or
  later state and a total for completed rides; offers allow one pending offer per driver.
- Every change writes a `ride_events` row (who, when, data) and an outbox event.
- **Cancellation**: the rider cancels free until the driver has arrived and the free waiting ran
  out; after that the tariff's fee is recorded (see owed fees below). A driver may end the ride
  as a **no-show** only `no_show_after_minutes` (5) after arriving; it counts on the rider
  (`no_show_count`, shown to drivers) and records the same fee. Any other driver cancellation
  sends the ride **back to dispatch** instead of cancelling it, and counts against the driver's
  reliability (the reason is stored as a code, labelled for operators: `src/lib/reasons.ts`,
  `GET admin/reasons`). Operators can cancel anything open, including a ride in progress.
- **Owed cancellation fees** (cash rides): the fee is `owed` (`rides.fee_status`) until the
  rider's next **cash** ride collects it. The quote shows it as its own line (`owedFee`: amount,
  the rides it comes from; the fares themselves are unchanged, the price promise stays); the
  order attaches the owed rides to the new ride (`fee_collect_ride_id`, `rides.owed_fee`) and
  the driver's screen says how much cash to take (`collectCash` = fare + waiting + owed). On
  completion the fee is the waiting driver's money: the collecting driver is debited
  (`cancel_fee_collected`) and the driver it is owed to credited (`cancel_fee`), both once per
  ride (unique ledger index). A cancelled collecting ride leaves the fee owed for the next one; a
  card ride never collects it (the prepayment stays the quoted fare); operators see owed fees in
  the caller lookup and the ride view and can waive one (`POST admin/rides/:id/fee/waive
{ note }`; a ride carrying it collects that much less). Phone orders collect them like app
  orders. Not collected: fees of card rides (refunded in full) and late seat cancellations on the
  trip board (recorded only).
- **Completion**: fare = quote + paid waiting. Cash is collected by the driver (`paid`); the
  ride's tax and commission are debited from the driver's balance in the same transaction.
- **Operators** order by phone for callers without the app (MA O1): the price is computed on the
  spot, the caller gets SMS updates with the car, plate and driver's number. An operator's quote
  with `scheduledFor` makes the phone order a ride for later (it may coexist with a ride now).
- **ETAs for the rider**: the car's road ETA to the pickup while it comes (`driverEta`,
  `driver.location.etaS`) and to the destination during the trip (`destinationEta`,
  `driver.location.destinationEtaS`), each one router call per ride per 15 s, cached in Redis.

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
dropped this ride, a comfort car for comfort rides, the car features the options need (luggage:
a big trunk **without** the CNG tank in it, `vehicles.cng_in_trunk`), a verified licence card.

**Priority score** (0–100, `src/lib/priority.ts`), shown to drivers with its parts, like Yandex's
transparent priority in Uzbekistan (MA §1.5): 40% acceptance (accepted / received offers, prior
8 of 10; only direct offers count as received — a broadcast another driver took first, or one
let pass, says nothing about the driver; an accepted broadcast counts both), 30% reliability (1 − rides dropped after accepting / accepted, prior 10 clean rides),
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

**Cargo cars** (Damas, Labo, Gazel, Porter) are not passenger taxis: the rules above for the car
do not apply to them, cargo rules do (a van/pickup/truck body, a payload, ≤ 25 years, category
C above 3.5 t), and they get cargo rides only — see [shared-rides.md §8](shared-rides.md).

**Licence cards** are checked with the Ministry of Transport's registry through the
`LicenceRegistry` adapter ('manual' today: operators check and record it); approval and going
online need a verified card. **Electronic fiscal receipts** for every completed ride and seat
go through the `FiscalProvider` adapter ('none' today: prepared and kept, sent later), retried
through the outbox. Both: [fiscal-and-licence.md](fiscal-and-licence.md).

Plates are validated in both current formats (`20 A 123 BC`, `20 123 ABC`) with real region
codes; licence numbers as two letters + seven digits. The licence card number format is not
public, so it is only sanity-checked; verifying it against the Ministry of Transport is item A5.

## 8. Money (MA §6.3 "Driver fee model")

- **Cash first** (63% of legal taxi turnover in 2026, MA §5.5). **Card rides are prepaid** by
  Payme or Click before dispatch (the fare is fixed at the quote); cancelled paid rides are
  refunded in full; the fare is credited to the driver's balance (`card_fare`), operators record
  payouts. Drivers **top up by card** too. Details and the reasons: [payments.md](payments.md).
- **Driver balance** is an append-only ledger: a trigger refuses updates and deletes, and the
  runtime role has no UPDATE/DELETE on the table. Balance = sum of entries. Entries: `topup`
  (cash at the office, or Payme/Click once per payment), `commission`, `tax`, `pass`,
  `adjustment` (with a note), `card_fare` (a card ride's prepaid fare, owed to the driver),
  `payout` (card money paid out to the driver). An operator's identical entry within a minute is
  refused (double click). A ride is charged each kind at most once (unique index), so retries cannot double-charge.
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

SSE events are nudges (refetch the resource), never more than the recipient may read; the
payloads with data are the driver's position (with the road ETA to the pickup, or to the
destination during the trip, recomputed at most every 15 s) sent to the rider of that ride
straight from the location endpoint, and the operators' `drivers.positions` batch (every online
driver, every 5 s, from the worker; `offline` names drivers on the previous batch who are gone,
and with nobody online an empty batch still goes out, at least once a minute, so maps drop
stale markers). Push (Expo) and SMS are sent by the worker from outbox events and logged per
(event, recipient, channel), so retries never send twice; a push outage retries the event; dead
tokens are removed. Offers are pushed as urgent messages that expire with the offer. Riders also
hear about card refunds (queued, made) and operators' answers to complaints; drivers about a paid
top-up and an answered appeal (push and stream).

## 11. Intercity trip board (MA §6.4)

Drivers publish departures between towns (the 11 Sirdaryo towns and Tashkent, each with a
meeting point: Guliston avtovokzali, Olmazor in Tashkent); riders book seats; operators book
for callers (SMS with the car and the driver's phone).

- **Seat price**: 30% of the whole-car intercity fare by road distance (min 25 000 for the car),
  front seat +10% (`src/lib/intercity.ts`), or an operator's route price (Guliston↔Tashkent
  70 000 / 80 000 seeded, MA §6.3 [H]); comfort cars in the tariff's comfort/economy ratio. A
  driver may ask within ±15% (`admin/settings/intercity`); the prices are fixed on the trip.
- **Seating rule** (founder's hard rule): 1 passenger in front and never more than 2 in the
  back: a trip offers at most 3 seats, 2 without the front seat; a booking takes 1..3 seats
  (`GET driver/config` → `intercity.maxSeats` / `maxRearSeats`; table checks since 0015).
- **Publishing**: active driver, licence card valid on the day, balance above the minimum,
  seats ≤ the car's and the seating rule, 15 minutes to 7 days ahead, departures of one driver 2 hours apart (the
  timing rules are in `GET driver/config` → `intercity`). Until the first live booking the driver
  may change the time, seats, front seat, price (within the band), meeting point and comment
  (`PATCH driver/intercity/trips/:id`, the same checks); after it only cancelling is possible.
- **Booking**: seats counted **on the trip row under its lock**, backed by table checks and
  partial unique indexes (`seats_booked ≤ seats_total`, one front seat, one live booking per
  rider per trip): however many riders tap at once, never oversold (concurrency tests). Retries
  are safe (`clientRequestId`, riders' and the panel's, serialised by an advisory lock). Riders
  see the driver's phone and the plate only once booked. An app booking pays a **deposit** by
  card first (20%, min 5 000, `admin/settings/booking`; `awaiting_payment` holds the seats for
  15 minutes), the rest (`payCash`) in cash; operators' phone bookings pay none
  ([payments.md](payments.md#booking-deposits-trip-board)).
- **Along the way** (yo‘l-yo‘lakay): the search also returns trips between other towns that
  pass the rider's (`alongTheWay: true`, `pickup` / `dropoff`): going through the rider's towns
  in order adds at most `along_route_max_km` (15 km, straight lines: Guliston → Sirdaryo →
  Toshkent is the road, 12 km more than the straight line) and the rider's part is at least
  30% of the trip. The seat costs its share of the trip (rounded up to 1 000, at least 30% of
  the seat); booking with `from`/`to` keeps the rider's towns for the driver.
- **Cancellation**: riders free until 60 minutes before departure, then 30% of the booking is
  recorded as owed (the rules are in `GET config` → `intercity`, the trip view's `cancelRules`
  and the booking's `cancelFreeUntil` / `cancelFeeNow`); with a deposit, a free cancellation
  refunds it and a late one leaves it to the driver instead of the fee. A driver's or
  operator's cancellation refunds deposits; a driver's cancellation of a booked trip counts
  against reliability.
- **Running it**: boarding opens an hour before; the driver boards passengers; at departure the
  absent become no-shows; on arrival every booking is charged the 1% tax and the intercity
  commission (per booking, capped, on the full price) and gets its fiscal receipt; deposits
  (held by the platform) are credited to the driver's balance, also a no-show's. The rest of
  each seat is paid in cash.

## 12. Uploads

Driver documents (passport, licences: personal data), the driver's photo and the car's photo go
**straight from the app to a private S3 bucket** (SeaweedFS locally and in the bundled
production profile) with a presigned PUT whose signature covers the type and the length. The
app then calls `complete`: the API checks the stored size and the file's signature bytes
(JPEG, PNG, WebP, PDF for documents) and deletes anything else. Reads are presigned GETs valid
15 minutes, handed out only to the owner and operators, and for the face and car photos to the
rider of the ride. Uploads never completed are removed after a day. Riders attach up to three
complaint photos (purpose `complaint_photo`, images only, read by the rider and operators).

## 13. What is not built yet (next steps)

Built since the first release: uploads, card payments and top-ups, the intercity board, the
fiscal and licence adapters, the apps' and panel's gaps (config, ETAs, saved places, complaints,
appeals, customer lookup, positions), the audit fixes and the production deployment; wave 3:
scheduled phone orders, idempotent phone bookings, the payments list, card money owed, receipt
retry, offline positions, per-app payment returns, refund/complaint/top-up/appeal pushes, the
destination ETA, store links, complaint photos, hidden recent places, editable trips, reason
labels, document types, collecting owed cancellation fees, and a load test (below).

Backend backlog:

- **Legal integrations switched on**: the OFD provider and the Ministry of Transport registry
  (the adapters are ready; [fiscal-and-licence.md](fiscal-and-licence.md) lists what is needed).
- Promo codes, masked calls
  (a telephony provider's number masking; today riders and drivers see each other's phones only
  within a ride or a booking), tips by card, owed fees of card riders and late seat cancellations,
  automatic payouts.
- The shared driver pool with SFF Eats (A9); a load test on the production host with two API
  replicas (the laptop run and its fixes: [audit.md](audit.md) "Load test").
- Deployment in a UZ data centre: [deploy.md](deploy.md).
