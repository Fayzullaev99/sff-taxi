# SFF Taxi Haydovchi (driver app)

Expo SDK 57 / React Native 0.86 / expo-router app for SFF Taxi drivers in Guliston. Uzbek
(Latin) UI, Android first (`uz.sff.taxi.driver`). Built on the proven parts of the SFF Eats
courier app (API client with refresh rotation, SSE with single-use tickets, background GPS
with a foreground service, loud push channel, navigator deep links).

## Brand

Same pair as the rider app: **yellow `#FFC400` on near-black `#111111`** (`src/config.ts`,
`src/ui/theme.ts`). The driver app is dark throughout: less glare in a car at night, cheaper
on OLED batteries, and every text/background pair is at least WCAG AA (yellow on #111 is
11.6:1). Filled yellow buttons use `#111` text. Icon: a yellow taxi roof sign with a checker
band on #111 (`assets/icon.png`, `assets/adaptive-icon.png`).

## Run

```bash
npm install                                   # at the repository root
EXPO_PUBLIC_API_URL=http://192.168.1.10:3200 npx expo start   # from apps/driver
```

| Variable                     | Default                           | What                                                          |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`        | `http://10.0.2.2:3200`            | API (the default is the host from an emulator)                |
| `EXPO_PUBLIC_SUPPORT_PHONE`  | none (button hidden)              | Office line when the API publishes none (`SUPPORT_PHONE`)     |
| `EXPO_PUBLIC_OFFICE_ADDRESS` | `SFF Taxi ofisi, Guliston shahri` | Office address when the API publishes none (`OFFICE_ADDRESS`) |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | none (push off)                   | Needed for Expo push tokens                                   |

Background location, the custom notification sound, the camera and the Payme/Click pages
need a development/production build (`eas build -p android --profile preview`); Expo Go falls
back to foreground GPS.

The app version (`app.json` `version`, now `1.0.0`) is compared with the API's
`MIN_DRIVER_APP_VERSION` (unset by default: no forced update); set it above an old build's
version to stop that build. The update screen opens `STORE_URL_ANDROID_DRIVER` /
`STORE_URL_IOS_DRIVER` (`GET /v1/config` → `storeUrls.driver`), else the Play Store page of
`uz.sff.taxi.driver`.

## Screens

| Route              | What                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `sign-in`          | Phone + SMS code (`client: driver`)                                                                                                   |
| `apply`            | 3-step application wizard (personal/PINFL, licence + licence card, car with plate hint, gas tank in the trunk)                        |
| `documents`        | The 7 required documents, the driver's photo and the car's photo: camera / gallery / PDF, upload with progress                        |
| `status`           | Pending / rejected / blocked with the reason, licence card check, what still blocks work, appeal                                      |
| `appeals`          | Rejected or blocked: write an appeal (one open at a time), see the operators' answers                                                 |
| `(tabs)/home`      | Big online/offline switch, GPS indicator, blockers, low-balance top-up, promo, today                                                  |
| `offer/[id]`       | Full-screen offer: countdown ring, sound + vibration, fare (+ owed fee line), pickup ETA, destination, scheduled time, accept/decline |
| `ride`             | Navigate → Yetib keldim (free/paid waiting timer) → Boshlash → Yakunlash; cash to take with its parts; cancel reasons; SOS            |
| `ride-done/[id]`   | Cash to collect shown huge (`collectCash`: fare, paid waiting, owed fee explained), ride earnings, rate the rider                     |
| `(tabs)/money`     | Balance, card top-up, promo banner, the rules in force, passes, earnings day/week with tax, latest entries                            |
| `topup`            | Card top-up: amount, Payme/Click page in an in-app browser, waits for the payment (event/push, polling fallback), history             |
| `ledger`, `rides`  | Full balance history (card-ride fares, payouts, cancellation fees) and ride history (cancel fee status), paged FlatLists              |
| `(tabs)/intercity` | The driver's intercity departures: upcoming (soonest first), then past ones (paged)                                                   |
| `intercity/new`    | Publish a departure: towns, day and time, seats, front seat, price within the band; `?edit=<id>` changes one                          |
| `intercity/[id]`   | Passengers (name, phone, seats, pickup note), edit before the first booking, boarding → board → depart → arrive, cancel               |
| `(tabs)/priority`  | The 0–100 score explained: parts, points, how to improve, what it is not used for                                                     |
| `(tabs)/profile`   | Car (luggage rides or not), licence card and its check, documents, notifications, GPS, navigator, sign-out                            |

`src/realtime/driver-runtime.tsx` runs under every approved screen: SSE, push taps, GPS
while online or on a ride, keep-awake on a ride, opening new offers full-screen and
jumping to a ride an operator assigned. A driver who applied but cannot work (pending,
rejected, blocked) gets only the SSE and push taps (`ApplicantRuntime`), so a decision or an
appeal answer shows at once.

## Decisions

- **Rules from the API.** Commission, caps, passes, minimum balance, offer lengths,
  waiting/no-show minutes, the trip board's rules (`intercity`: publish window, trip spacing,
  boarding, price band, riders' cancellation terms), decline reasons, top-up limits and
  support contacts come from `GET /v1/driver/config`; feature flags, card providers, the
  minimum app version (null: no forced update) and the store links from `GET /v1/config`
  (`lib/driver-config.ts`, tolerant: a missing field keeps the launch default). Below the
  minimum version only the update screen is shown; it opens `storeUrls.driver[platform]`,
  else the Play Store page.
- **Cash to collect** (`lib/ride-flow.ts` `cashBreakdown`): the big number on the ride and
  done screens is the API's `collectCash` (cash fare + paid waiting + fees the rider owed
  from earlier cancelled cash rides; the live waiting timer replaces the stored waiting fee
  while it runs; an older API falls back to fare + waiting). The owed part is explained
  ("shundan X so‘m — yo‘lovchining oldingi bekor qilingan safari uchun"): it is debited from
  the collecting driver (`cancel_fee_collected`) and credited to the driver it was owed to
  (`cancel_fee`). The offer shows it as a separate "+ X so‘m … (naqd)" line.
- **Uploads** (`lib/upload-flow.ts`, `src/uploads`): pick (camera, gallery, or a PDF for
  documents) → resize/compress (longest side 2000 px for documents, 1080–1600 px for photos,
  JPEG 0.7, smaller passes while over the purpose's limit from `GET /v1/uploads/config`) →
  `POST /uploads` → PUT to the presigned URL with the signed headers and progress
  (`expo-file-system`) → `complete` → attach (`PUT driver/documents/:kind`, `driver/photo`,
  `driver/vehicle/photo`). A failure keeps how far it got: "Qayta urinish" re-attaches, re-sends
  to a still-valid URL, asks for a new URL after a 403 or expiry, or starts over when the API
  deleted a mismatching file — without taking the photo again.
- **Offer countdown on the server clock.** Cheap phones often have a wrong clock. The API
  client reads the HTTP `Date` header and the countdown runs on the estimated server time,
  capped at the offer's published length — `lib/countdown.ts`.
- **Offers close at once.** `offer.closed` (taken by another driver, withdrawn, expired)
  closes the offer screen immediately; re-checking `GET /driver/offers` (3 s without the
  stream, 10 s with it) is only the fallback for a missed event.
- **One sound per offer.** An offer from the stream plays a local notification on the
  `offers` channel (custom `offer_alert.wav`, max importance, long vibration); the push for
  the same offer is then silenced by the notification handler.
- **Card money.** Card rides are prepaid: the ride and done screens say "naqd olmang" and
  show only the paid waiting as cash; the fare arrives in the ledger as `card_fare`, operator
  payouts as `payout`. Top-ups by card open the provider's page in `expo-web-browser`; the
  stream's `topup.updated` (or the `topup_paid` push, whose tap opens `topup?id=…`) marks the
  watched top-up paid at once, refreshes balance and ledger, and stops the polling of
  `GET /driver/topups/:id`, which is only the fallback (3 s, then 10 s without the stream;
  15 s with it) until paid or expired.
- **Appeal answers** arrive as `appeal.updated` / the `appeal_resolved` push (tap: `appeals`,
  or home when the answer unblocked the account); the status and appeals screens re-read
  `GET /driver/appeals` every minute without the stream, every 5 minutes with it.
- **GPS paced by what the driver does** (`lib/location-policy.ts`, market research §6.7):
  online and free ~every 15 s (a 50 m move after 10 s, a parked car every 30 s so dispatch's
  120 s freshness window never lapses), to the pickup ~4 s, waiting at the pickup ~10 s, on a
  trip ~3 s; every interval doubled below 15 % battery when not charging (`expo-battery`, a
  chip under the GPS indicator). High accuracy while tracking; offline without a ride the
  GPS is off. The provider is restarted only when its pace changes (the foreground-service
  notification says what the driver is doing).
- **Fix filter and queue** (`lib/location-throttle.ts`): fixes over 100 m are never sent,
  50–100 m ones are skipped while good fixes keep coming, duplicates/out-of-order and fixes
  older than 30 s are dropped (the API stamps a fix with its own clock and takes no trail).
  One request at a time (10 s timeout); without network the newest fix waits and is retried
  with backoff (1 → 30 s), at once when NetInfo reports the connection back; a 422 refusal
  only changes the GPS indicator. The phase is saved so a background-only JS runtime keeps
  the right pace.
- **Stream health**: the API pings every 25 s; 35 s of silence means a dead link and the
  stream reconnects (polling speeds up meanwhile), at once when the network returns or the
  app comes to the foreground; a stream past 256 KB is renewed. While on shift with the
  background location service, the stream stays open in the background too, so an offer
  sounds at once with the navigator in front (push remains the fallback).
- **Accept and steps survive a bad network** (`lib/ride-actions.ts`): a request with no
  answer is re-sent (accept 8 s timeout, 4 tries; steps 12 s, 8 tries); a 409 after that is
  checked against the ride (the current ride is this offer's / the ride already reached the
  step) before it is shown as a failure. Accept ignores second taps; "Yetib keldim" and
  "Boshlash" show their result at once and are undone if they fail; the footer says
  "Yuborilmoqda…" / "Aloqa sust — qayta yuborilmoqda (n)…".
- **Cold start**: profile, current ride, balance, today and the rules are kept on disk
  (`lib/snapshot.ts`, `data/persist.ts`) and shown at once after a restart, then refetched.
- **Stops, not "pickup and drop-off"**: the ride and home screens render `lib/stops.ts`'s
  ordered stop list (`src/ride/parts.tsx`, `src/home/current-ride-card.tsx`), so several
  riders at once only add stops.
- **Decline asks for an optional reason** (the API's `declineReasons`) after the tap, accept is
  a single 84 px button (on the right on a landscape tablet).
- **Low-end Android**: no maps SDK, no SVG/animation libraries (the ring is 36 plain
  views, redrawn on its own 250 ms tick while the rest of the offer screen redraws once a
  second), lazy tabs, memoised paged FlatLists, one GPS request in flight, the GPS indicator
  re-renders only when its text changes, polling backs off while the stream is open.
- **Battery optimisation**: while online, home warns when Android's battery optimisation is
  on for the app (it stops the location service on many cheap phones) and opens the settings.
- **Navigation**: the first "Yo‘l" tap asks Yandex Navigator / Yandex Maps / Google Maps and
  remembers it (changeable in Profil); web fallback when the app is missing.
- **CNG**: the wizard's "gas tank in the trunk" switch (default on — most Cobalts/Nexias) is
  sent as `vehicle.cngInTrunk`; a big trunk may still be ticked, luggage rides then skip the car.
- **Intercity**: departure times are Tashkent time whatever the phone's zone; the price
  stepper stays inside the band from `GET /driver/intercity/fares` and the front seat keeps
  the reference proportion, like the API. The tab lists `scope=upcoming` (the API's order,
  no client sorting) and below it the past trips from `scope=all`. A trip is editable
  (`PATCH`, only the changed fields; the route stays) while `scheduled` with no seat held
  (`lib/intercity.ts` `tripEditable`, `tripEdits`); the publish form doubles as the edit form.
- **Documents**: a PDF is recognised by the document's `contentType` (shown as a file icon).

## API gaps (found while building; the API was not changed)

Closed by API wave 3 (kept for the record):

1. ~~Offers carry no `scheduledFor`~~: offers and `offer.new` carry it (and `owedFee`).
2. ~~Top-up completion is not pushed~~: `topup.updated` / the `topup_paid` push; the return
   link is per purpose (`PAYMENT_RETURN_URL_TOPUP`, e.g. `sff-taxi-driver://topup?id={intentId}`
   — the route reads `id`).
3. ~~Appeal answers are not pushed~~: `appeal.updated` / the `appeal_resolved` push.
4. ~~Intercity rules are not published to drivers~~: `GET /driver/config` → `intercity`.
5. ~~Decline reasons are stored as sent~~: still stored as the code, but operator views now
   label decline/release codes in Uzbek.
6. ~~Trips ordered by creation, not editable~~: `scope=upcoming|all` by departure;
   `PATCH /driver/intercity/trips/:id` before the first booking.
7. ~~Documents do not say their file type~~: `documents[].contentType`.
8. ~~`MIN_DRIVER_APP_VERSION` defaults to `1.0.0`~~: unset by default (no forced update);
   `storeUrls` for the update screen.

Still open:

9. **Only a paid top-up is announced**: `topup.updated` is sent for `paid` only; an intent that
   expires or is cancelled emits nothing, so the top-up screen learns it by polling (the
   fallback it keeps anyway).
10. **An offer's `owedFee` can go stale**: an operator waiving a fee emits `ride.changed`,
    which reaches the assigned driver (`ride.updated`) but not drivers who only hold an offer;
    they see the old amount until the offers list is re-read (the ride screen is right).
11. **Fees owed to the driver are invisible until collected**: a rider-cancelled cash ride's
    fee is credited (`cancel_fee`) only when the rider's next cash ride completes; the driver
    sees the pending amount only per ride (`fare.cancellationFeeStatus` in the ride history),
    with no total "owed to you" figure in `GET /driver/balance`.
12. **`scope=upcoming` is capped at 100 trips** with `nextCursor: null`; harmless for one
    driver today, but the list would silently cut off.
13. **The stream's heartbeat is 25 s**: a dead mobile link is noticed only after ~35 s
    (the reference is a 4 s ping and a 7 s dead-link limit). A 5–10 s ping (a few bytes)
    would let the app switch to polling much sooner.
14. **`POST /driver/location` takes one fix stamped with the server's clock**: a fix held
    during an outage cannot be sent with its real time, and no short trail can be sent when
    the link comes back (an optional `at` and a `trail[]` of ≤10 fixes would fix both).
15. **Accept and ride steps are not idempotent**: a retry after a lost answer gets 409
    ("Taklif endi amal qilmaydi" / "Buyurtma holati mos emas"); the app reconciles by
    re-reading the ride. An idempotency key, or answering 200 with the ride when it is
    already in the step's status, would save that round trip on a bad network (and allow
    Uber-style offline steps with client timestamps).

## Checks

```bash
npm run typecheck -w apps/driver
cd apps/driver && rtk proxy npx vitest run --reporter=default   # pure logic in src/lib
npx expo export --platform android                               # from apps/driver
rtk proxy npx prettier --check apps/driver && rtk proxy npx eslint apps/driver  # from the root
```
