# Wave 4: shared rides, women drivers, fixed routes, deposits

What the founder asked for (2026-09-29) and how the platform does it. Competitor facts behind
the defaults: [market-research-v2.md](market-research-v2.md). Engine: `apps/api/src/lib/pool.ts`
(pure, unit-tested), I/O: `apps/api/src/modules/rides/pool.service.ts`, dispatch:
`apps/api/src/modules/dispatch/dispatch.service.ts`, schema: `migrations/0015_*.sql`.

## 1. The seating rule (hard)

One passenger in front, **never more than two in the back**: at most **3 passengers** per car,
whatever its registered seats (`MAX_PASSENGERS`). Enforced three times:

- the API refuses orders of more than 3 people, driver settings that would overfill the car,
  trip-board trips with more than 2 rear seats;
- the matching engine never plans a car over capacity at any point of its route;
- a database trigger (`rides_seating_guard`) refuses any change that puts the riders of a
  driver's active rides plus the people riding without the app above `LEAST(seats, 3)`
  (`SF001`), and any second active ride of a driver outside one shared pool (`SF002`).

## 2. Shared rides ("Hamroh bilan")

**Rider**: a "Boshqa yo'lovchini olishga roziman" toggle on the order (`shareable: true`, cash
only for now: a card prepayment cannot be partly refunded). The quote shows the discount
(`pool.discountPercent`) and **cars already going that way before ordering**
(`pool.cars[]`: road ETA, people in the car now `inCar`, `occupied`/`free` seats, front/rear),
so a rider on the road knows whether the coming car has people in it and how many.

**Driver**: `PUT driver/preferences` — `poolEnabled` ("Boshqa yo'lovchi olaman"),
`extraPassengers` (people in the car without the app, 0–3; they need a `destination`),
`destination` (where the driver is heading: only rides on the way are offered — the Yandex
"Domoy" pattern), `womenRidersOnly`. Riders sharing the car show as an ordered stop list in
`driver/rides/current` → `pool.stops`; the current ride is always the next stop's.

**Matching** (every dispatch step): free cars are ranked by road ETA as before; cars on their
way (carrying riders who share, or heading somewhere) are checked by inserting the new pickup
and drop-off into their stops ahead (`bestInsertion`, every position pair, a routing matrix):

| Rule                                             | Default (`admin/settings/pool`)     |
| ------------------------------------------------ | ----------------------------------- |
| Delay for anyone already in / waiting for car    | ≤ 6 min city, ≤ 15 min intercity    |
| ... and at most this share of their own time     | 50% (at least 2 min allowed)        |
| New rider's own ride not much longer than direct | same limits                         |
| Car reaches the new rider within                 | 15 min                              |
| Cars considered                                  | within 8 km                         |
| A car already carrying riders is preferred by    | 90 s of ETA                         |
| Riders (orders) per car                          | 3                                   |
| The new rider gets in before the last one out    | always (otherwise it is not shared) |
| The driver's destination stays the last stop     | always                              |

The driver does not wait for anyone to get out: a rider is only matched if they fit on the
way. A rider who did not agree to share is never put in an occupied car. The match is computed
again under the locks when the driver accepts (the car moved, others may have joined); racing
riders for the last seat: exactly one gets it (locks + the trigger, tested).

## 3. Shared prices

Each rider's quoted price is the ceiling; sharing only lowers it. The discount follows the part
of the rider's own trip actually shared with another app rider (people riding without the app
do not count — nothing proves they were there):

```
discount = fare × discount_percent × min(1, shared_km / (trip_km × full_discount_share_percent))
```

Defaults 15% and 50%: the founder's example — A 100 000, B joins halfway and rides to the same
place (B's price 40 000) — gives **A 85 000, B 34 000, driver 119 000** (unit test
`matches the founder's example`). A rider sharing 5 km of a 40 km trip gets a quarter of the
discount, not all of it. Shared metres are kept per ride and adjusted by the plan's change on
every join and leave: when the other rider cancels before getting in, the price goes back.
A match is refused unless the driver's total after every discount grows by more than the
detour costs (added km × the tariff's per-km price) — the driver never loses by sharing.
Fixed per-seat route prices are already a shared price: no discount on top. All of it is
computed on the server; the apps show `fare.pays`, `fare.poolDiscount`. Riders hear about
changes by push (`ride.pool_changed`).

## 4. A woman driver

- Riders declare their gender in the profile (`PATCH me {gender}`, changeable once per 30
  days: switching back and forth to reach women drivers is refused). The option
  (`womenOnly: true`) is offered to women only; the quote shows free verified women drivers
  nearby (`womenOnly.drivers`).
- Drivers declare it in the application; **operators verify it against the passport**
  (`POST admin/drivers/:id/gender`). Only verified women drivers get such rides.
- A verified woman driver may take **women riders only** (`womenRidersOnly`, Uber's
  "Women Preferences" pattern).
- In a shared car with a women-only rider everyone is a woman, and no people without the app.
- No price premium. Such rides carry a start code (below).

## 5. Start code (safety)

Rides at night, shared rides, women-only rides and intercity rides get a 4-digit code
(`riderView.startPin`); the driver starts the trip only with it (`POST driver/rides/:id/start
{pin}`): the right rider in the right car.

## 6. Fixed route prices between towns

Per km a long ride costs one person too much (Yangiyer → Guliston by the tariff ≈ 60 000 for
the whole car). Operators fix route prices (`PUT admin/routes {from, to, seatPrice, carPrice,
bothWays}`; riders see them at `GET routes`): **a seat** in a shared car (seeded:
Yangiyer ↔ Guliston 10 000, Guliston ↔ Toshkent 70 000) and/or **the whole car**. A trip gets
the route price when its pickup is in the first town's zone (its boundary + `zone_radius_m`,
or a circle around Tashkent) and its drop-off in the second's. It works even from towns not
yet open for in-city rides. Seat mode (`fareMode: 'seat'`, `passengers` 1–3) is a shared ride:
the car takes other riders going the same way.

## 7. Deposits for bookings in advance

A ride ordered for later and a seat on the trip board are booked once part of the price is
paid by card (`admin/settings/booking`, default 20%, at least 5 000). The rest is cash to the
driver. Cancelled in time or by the platform: refunded; late or no-show: the waiting driver's
compensation. Operators' phone bookings are exempt.

## 8. Services: cargo and delivery

`rides.service` is `taxi`, `cargo` ("Yuk tashish") or `delivery` ("Yetkazib berish"). All three
use the same quotes, rides, dispatch, money, receipts and notifications. Pricing:
`apps/api/src/lib/cargo.ts` (pure, unit-tested), schema: `migrations/0017_cargo_delivery.sql`.

**Cargo cars.** A car declared `service: 'cargo'` in the application (`vehicle.body` van, pickup
or truck; `payloadKg`; optional `grossKg`) is a cargo car: `vehicles.cargo_class` is set from its
payload (up to 800 kg **`cargo_s`**, Damas/Labo class; above **`cargo_m`**, Gazel/Porter/Isuzu,
up to 1.5 t; operators may correct it with `PATCH admin/drivers/:id/vehicle {payloadKg,
cargoClass}`). Resolution 200's passenger-taxi rules (no vans, at most 4 seats, at most 15 years)
do not apply to it; the cargo rules do: a cargo body, a payload, at most 25 years, and a category
C licence above 3.5 t total mass (B is enough up to 3.5 t, e.g. a Gazel 3302). A car with a van,
pickup or truck body is refused as a taxi. A cargo car gets **cargo rides only** (never taxi
rides, deliveries or passenger trips on the trip board). The licence card and the other
documents are asked for as for taxi drivers (to be reviewed with a lawyer: the freight regime
of Damas/Labo is unverified, market research v2 §4).

**Cargo prices** (`GET/PUT admin/settings/cargo`, fixed at the quote, no surge):

| Part                               | `cargo_s` | `cargo_m` |
| ---------------------------------- | --------- | --------- |
| Base, including 10 km and 20 min   | 35 000    | 56 000    |
| Per started km beyond              | 1 500     | 2 400     |
| Per km beyond, intercity (≥ 20 km) | 1 500     | 2 400     |
| Per minute of loading beyond 20    | 300       | 400       |
| Heaviest load                      | 700 kg    | 1 500 kg  |
| Loader ("yukchi"), per person, 0–2 | 30 000    | 30 000    |
| Night (23:00–06:00), not loaders   | +20%      | +20%      |

Anchors: Yandex Fergana 2021 58 000 incl. 10 km and 20 min, Tashkent 63 000 incl. 15 km and
10 + 10 min loading; Guliston car fares ~20% below; medium ×1.6 [H]. The included minutes are
the ride's free waiting after arrival (loading), then the per-minute price (the ride's tariff
snapshot keeps them); unloading is not timed. The customer may ride in the cab (`riderRides`,
one person, nobody in the cargo bay).

**Delivery** is a small parcel (≤ 10 kg, a seat's worth) carried by a **taxi car**: the taxi
classes' fares, or `delivery.percent` of them (default 100%). The sender is not in the car; the
order needs the recipient's name and phone, which the driver sees. When the driver starts the
trip (with the start code at night and between towns, as usual), the sender gets a push and the
recipient an SMS with the car and the driver's phone; the sender is told "Posilka yetkazildi"
at the end. A delivery is never shared and has no woman-driver option.

**Dispatch**: cargo rides go only to online cargo cars whose class fits (a medium car takes small
loads, not the other way round); taxi rides and deliveries never go to a cargo car; everything
else (balance, licence, GPS freshness, women filters, offers and broadcast) is unchanged. An
operator's manual assignment is checked the same way (409).

**Money**: cargo and deliveries are billed exactly like taxi rides of the same kind: city rides
count in the percent and the daily/weekly caps (and passes), rides ≥ 20 km are intercity (per-ride
cap), the 1% tax is withheld. Separate cargo commission rates can come later as their own
billing settings. Receipts name the service: `fiscal.cargo_item_name` ("Yuk tashish xizmati"),
`fiscal.delivery_item_name` ("Yetkazib berish xizmati (posilka)"), defaults when absent; the
MXIK code stays one placeholder until the classifier codes are confirmed.

## 9. API changes (all additive; old apps keep working except the start code)

| Endpoint                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST rides/quote`                                                       | + `seats {max:3, front:1, rearMax:2}`, `route {from, to, prices{economy?{seat,car}, comfort?}}` or null, `pool {available, discountPercent, fullDiscountSharePercent, cashOnly, cars[{etaS, detourS, inCar, occupied, capacity, front, rear, free}]}`, `womenOnly {available, reason: 'profile_gender'\|null, drivers {cars, etaS}}`; `fares.<class>.fixed {routeFareId, mode, price, passengers}` when a whole-car route price applies                                                                                                                                                                                                                                                                                                                                                                 |
| `POST rides`                                                             | + `passengers` (1–3), `shareable`, `womenOnly`, `fareMode` ('car'\|'seat'); 400 for card + shared, seat without a route seat price, >3 people; 403 womenOnly for non-women                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ride views (rider, driver, operator)                                     | + `service`, `passengers`, `shareable`, `womenOnly`, `fareMode`, `pool {id, sharedM}`, `hasStartPin`, `fare.poolDiscount`, `fare.pays`, `fare.deposit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GET rides/:id` (rider)                                                  | + `startPin` (open rides), `car {inCar, occupied, capacity, front, rear, free, riders}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET driver/rides/current`, `GET driver/rides/:id`                       | the next stop's ride; + `pool {riders, occupancy, stops[{rideId, number, type, lat, lng, place, riderName, passengers, status}]}` (null for one rider); `collectCash` minus discount and deposit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST driver/rides/:id/start`                                            | body `{pin}` required when the ride has a start code (400 otherwise)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET driver/offers`                                                      | + `along {detourS, stops[]}` (a ride on the car's way), `ride.passengers/shareable/womenOnly/fareMode`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `PUT driver/preferences`                                                 | new: `{poolEnabled?, extraPassengers?, destination?: {lat,lng,address}\|null, womenRidersOnly?}` → the driver profile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET driver/me`                                                          | + `gender`, `genderVerified`, `womenRidersOnly`, `pool {enabled, extraPassengers, destination, destinationSetAt, seats}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST driver/application`                                                | + `gender` ('female'\|'male', optional)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET/PATCH me`                                                           | + `gender`, `genderLockedUntil`; PATCH accepts `{fullName?, gender?}` (409 when changed within 30 days)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `POST admin/drivers/:id/gender`                                          | new: `{gender}` — verified against the passport                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET routes` (public), `GET/PUT admin/routes`, `DELETE admin/routes/:id` | new: fixed route prices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET/PUT admin/settings/pool`                                            | new: shared ride rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| realtime / push                                                          | `ride.changed` for co-riders; push `pool_joined` / `pool_left` with the new price; `driver.updated` status `destination_reached`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST rides/quote` (§8)                                                  | + `service` in the body ('taxi' default \| 'cargo' \| 'delivery'), `cargo {loaders 0–2, riderRides, description, weightKg}`, `parcel {description, weightKg ≤ 10}`; response + `service`. Cargo: `fares {cargo_s, cargo_m}` (each with `cargo {basePrice, includedKm, includedMinutes, extraKm, perKm, distance, perMinute, loaders, loaderPrice, loadersTotal, maxPayloadKg}`), `availability {cargo_s, cargo_m}`, `cargo {…options, maxLoaders, loaderPrice, maxRiders, classes{<class>{maxPayloadKg, includedKm, includedMinutes, perKm, intercityPerKm, perMinute, fits}}}`; delivery: `fares {economy, comfort}` (+ `delivery {percent}`), `delivery {percent, maxWeightKg, parcel, recipientRequired}`; both `pool.available: false`, `womenOnly: null`, `route: null`. Taxi quotes are unchanged |
| `POST rides` (§8)                                                        | `class` also 'cargo_s' \| 'cargo_m' (a cargo quote); + `cargo {description?, weightKg?}`, `parcel {description?, weightKg?}`, `recipient {name, phone}` (required for a delivery); 400 for a class of the wrong service, a load over the class's payload, shared/seat/womenOnly/passengers > 1 on cargo or delivery, a parcel over the weight limit. Operators' phone orders stay taxi only (400 for another quote)                                                                                                                                                                                                                                                                                                                                                                                     |
| ride views, `GET driver/offers` (§8)                                     | + `cargo {loaders, riderRides, description, weightKg}` (null unless cargo), `delivery {parcel, recipientName, recipientPhone}` (null unless delivery; offers show `service`, `cargo`, `parcel` without the recipient); `vehicle.body`, `vehicle.cargoClass` for cargo cars                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST driver/application`, `GET driver/me`, admin driver views (§8)      | `vehicle` + `service` ('taxi' default \| 'cargo'), `body`, `payloadKg`, `grossKg`; views + `cargoClass`. `PATCH admin/drivers/:id/vehicle` + `payloadKg`, `cargoClass` (cargo cars)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GET/PUT admin/settings/cargo`, `admin/settings/fiscal` (§8)             | new: cargo prices, loaders, night, `delivery {enabled, percent, max_weight_kg}`; fiscal + `cargo_item_name`, `delivery_item_name`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET admin/rides` (§8)                                                   | + `?service=`, `?class=` accepts cargo classes; `GET admin/dispatch/live` drivers + `cargoClass`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| push / SMS (§8)                                                          | "Yuk mashinasi topildi" (cargo assigned), "Yuk yetkazildi" / "Posilka yetkazildi" (completed); delivery: `parcel_picked_up` push to the sender, `parcel_on_the_way` SMS to the recipient                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
