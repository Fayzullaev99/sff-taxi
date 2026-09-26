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

| Variable                     | Default                           | What                                           |
| ---------------------------- | --------------------------------- | ---------------------------------------------- |
| `EXPO_PUBLIC_API_URL`        | `http://10.0.2.2:3200`            | API (the default is the host from an emulator) |
| `EXPO_PUBLIC_SUPPORT_PHONE`  | none (button hidden)              | Office line on status, top-up, appeal screens  |
| `EXPO_PUBLIC_OFFICE_ADDRESS` | `SFF Taxi ofisi, Guliston shahri` | Where drivers top up and appeal in person      |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | none (push off)                   | Needed for Expo push tokens                    |

Background location and the custom notification sound need a development/production build
(`eas build -p android --profile preview`); Expo Go falls back to foreground GPS.

## Screens

| Route             | What                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `sign-in`         | Phone + SMS code (`client: driver`)                                                                  |
| `apply`           | 3-step application wizard (personal/PINFL, licence + licence card, car with plate hint, CNG)         |
| `documents`       | The 7 required document photos (URL fields until the API has uploads)                                |
| `status`          | Pending / rejected with reason / blocked with reason, appeal contact                                 |
| `(tabs)/home`     | Big online/offline switch, GPS indicator, blockers, low-balance top-up, promo, today                 |
| `offer/[id]`      | Full-screen offer: countdown ring, sound + vibration, fare, pickup ETA, destination, accept/decline  |
| `ride`            | Navigate → Yetib keldim (free/paid waiting timer) → Boshlash → Yakunlash; cancel reasons; SOS        |
| `ride-done/[id]`  | Cash to collect shown huge, ride earnings (commission, 1% tax, net), rate the rider                  |
| `(tabs)/money`    | Balance, 0% promo banner, passes, earnings day/week with tax, latest entries                         |
| `ledger`, `rides` | Full balance history and ride history (paged FlatLists)                                              |
| `(tabs)/priority` | The 0–100 score explained: parts, points, how to improve, what it is not used for                    |
| `(tabs)/profile`  | Car, licence card expiry, documents, notifications + sound test, background GPS, navigator, sign-out |

`src/realtime/driver-runtime.tsx` runs under every approved screen: SSE, push taps, GPS
while online or on a ride, keep-awake on a ride, opening new offers full-screen and
jumping to a ride an operator assigned.

## Decisions

- **Offer countdown on the server clock.** Cheap phones often have a wrong clock. The API
  client reads the HTTP `Date` header and the countdown runs on the estimated server time,
  capped at the offer's length (15 s direct, 30 s broadcast) — `lib/countdown.ts`.
- **One sound per offer.** An offer from the stream plays a local notification on the
  `offers` channel (custom `offer_alert.wav`, max importance, long vibration); the push for
  the same offer is then silenced by the notification handler. Push while the app is in
  the background plays the same channel.
- **GPS every 3–5 s** while online or on a ride (min gap 3 s, at least every 5 s, or after
  25 m), fixes worse than 100 m are not sent, API refusals only change the GPS indicator.
- **Decline asks for an optional reason** after the tap (one tap more), accept is a single
  84 px button. A taken/withdrawn/expired offer says so at once (SSE `offer.closed`).
- **Low-end Android**: no maps SDK, no SVG/animation libraries (the ring is 36 plain
  views), lazy tabs, paged FlatLists, one GPS request in flight, polling backs off while
  the stream is open.
- **Navigation**: the first "Yo‘l" tap asks Yandex Navigator / Yandex Maps / Google Maps and
  remembers it (changeable in Profil); web fallback when the app is missing.
- **CNG**: the API has no gas-tank field; the wizard's "gas tank in the trunk" switch
  (default on — most Cobalts/Nexias) only prevents ticking "big trunk".

## API gaps (found while building; the API was not changed)

1. **No upload endpoint** for document photos: `documents.tsx` takes URLs
   (`TODO(api-uploads)` there says how to switch to expo-image-picker + presigned PUT).
2. **Billing settings are not readable by drivers**: promo end date, commission %, caps
   and pass prices are hard-coded defaults in `lib/money.ts` (`BILLING`). Suggest a
   `GET /v1/driver/billing-rules` (or include them in `/driver/balance`).
3. **`no_show_after_minutes` is not published**: the app assumes 5 min (the API enforces
   it and answers 409 with the right wait).
4. **Decline reason is not stored**: the app sends `{ reason }` with
   `POST /driver/offers/:id/decline`; the API ignores the body.
5. **Broadcast offers count against acceptance**: every broadcast offer increments
   `offers_received`, so a driver who loses a broadcast race to another driver (or ignores
   a broadcast) loses acceptance points. For fairness, broadcast offers taken by someone
   else should not count.
6. **No CNG / gas-tank vehicle field** (only `big_trunk`).
7. **No `offer.closed` when the ride goes to someone else**: `RidesService.assignDriver`
   (and `cancel`) set the other pending offers to `withdrawn` without emitting
   `ride.offer_closed`, so a driver who lost a broadcast hears nothing. The app polls
   `GET /driver/offers` every 3 s while an offer is open and says "taken or cancelled" when
   it vanishes; emitting the event (with a `taken` status) would make it instant.
8. **Card top-up (Payme/Click)** is backlog: the app shows office cash top-up steps.
9. **No driver-side support/appeal endpoint**: appeals are by phone/office (config vars).

## Checks

```bash
npm run typecheck -w apps/driver
cd apps/driver && rtk proxy npx vitest run --reporter=default   # pure logic in src/lib
npx expo export --platform android                               # from apps/driver
npx prettier --check apps/driver && rtk proxy npx eslint apps/driver  # from the root
```
