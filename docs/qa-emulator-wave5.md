# Emulator QA: wave 5 (rider and driver apps, Android)

Date: 2026-10-16 (day, Tashkent). Scope: the wave-5 features on real devices before the
advertising launch — the Miniven and Biznes classes, intermediate stops (now editable after
the order), orders for another person, the GULISTON promo code, referrals and ride credit,
the rider–driver chat, tips, Russian in both apps — plus the flows of earlier waves (shared
ride, start codes, women-only, fixed route seats, cancel fees, cargo), with the apps built as
release APKs against the real API and worker.

Branch `wave5-qa` (worktree `D:\sff-taxi-wt-qa5`), merged into `main`.

Result: **2 features built** (part 1: the ETA to the next stop; stops editable after the order
with a priced confirmation) and **4 bugs fixed**, one of them a release blocker (the Android
release build of both apps failed since the language layer landed); everything re-verified on
the devices except where noted. No crash, no JS error in `logcat`.

## How it was run

- **Devices**: `emulator-5554` Pixel_8 (rider) and `emulator-5556` Tablet_11, landscape
  (driver), both API 37 with Google Play, started by this run with
  `emulator -avd … -no-snapshot-load` (they were not running) and stopped at the end.
- **APKs**: as in the wave-4 doc: `expo prebuild --platform android --clean --no-install`
  once per app, then `gradlew assembleRelease -PreactNativeArchitectures=x86_64` (JBR from
  Android Studio), `EXPO_PUBLIC_API_URL=http://10.0.2.2:3200`, the cleartext plugin, no
  Google Maps key (map-less fallback), no EAS project id. Rebuilds after fixes with
  `expo prebuild` without `--clean` (re-applies the config mods, keeps the native build:
  ~7 min). **The first release build of both apps failed in `lintVitalRelease`** — bug 1
  below. `adb install -r` kept the sign-in.
- **Backend**: the dev DB `taxi` on :5460 (migrations 0020–0027 applied by this run), API :3200
  and worker :3201 built from the worktree (`node --env-file=.env dist/main.js` /
  `dist/worker.js`), `OTP_FIXED_CODES` for +998900000001 and +9989770001xx (111111),
  `PAYME_TEST=true` with the dummy merchant, `PUSH_PROVIDER=console`, `SMS_PROVIDER=console`.
  The launch campaign was applied to the dev DB with
  `node dist/scripts/launch-campaign.cli.js --apply` (GULISTON created, referral settings
  written). Minivan and Biznes were switched on in the operator tariff by
  `qa/wave5-setup.mjs setup`, which also created and approved two API-driven drivers:
  +998977000113 (Hyundai Starex 2022, 7 seats, minivan) and +998977000114 (Chevrolet Malibu
  2024, business). `node qa/wave5-setup.mjs serve <phone>` drove them as bots (accept,
  arrive, start, stops, complete, with a fresh position every 10 s and a re-sign-in when the
  15-minute token expires); `pay <intentId> <amount>` paid Payme intents through the API's
  JSON-RPC (Create + Perform), `geo` set the Pixel's GPS (`adb emu geo fix`).
- **UI driving**: `adb shell input`, `uiautomator dump`, `screencap` through a small Node
  helper (no Python). **Pitfalls** (as in wave 4): `uiautomator dump` returns a stale tree on
  animated screens (the offer countdown, the searching pulse, the waiting timer) and, on the
  Pixel, sometimes a tree of a screen two steps back — the results were read from
  screenshots and the API where it mattered. The phone field drops digits typed within ~1 s
  of the tap: type in chunks. The order sheet keeps the last class and payment method as a
  habit: a second order after a Biznes/card one is Biznes/card again unless changed (one
  stray card order and two stray cargo orders were cancelled in the run). The rider's home
  keeps the service switch (Yuk) too.
- **GPS**: the Pixel follows `adb emu geo fix` once the app asked for a fix (it first showed
  the Googleplex and a "Location Accuracy" dialog: "Turn on", then "Mening joylashuvim").
  The tablet's Google Play fused provider ignored `geo fix`; it was fed through the
  `gps`/`network` test providers (`appops set com.android.shell android:mock_location allow`,
  `cmd location providers add-test-provider …`, a 4-second loop) — "GPS yaxshi · ±8 m".
- **Accounts**: rider A +998977000102 (from wave 4, uz then ru), rider B +998977000104 (new,
  ru: GULISTON, invitation code, credit), rider C +998977000105 (API: the invitee), taxi
  driver +998935550101 "Jasur Raximov" (the tablet, Cobalt, from wave 4), bots 113/114.
  Operator actions through the API.
- **Keep-awake**: a `SetThreadExecutionState` PowerShell loop during the run.

## Test matrix

P = passed on the device; F→fixed = failed, fixed and re-verified on the device; API = through
the API only; note = passed with a remark (see "Open issues").

### Rider (Pixel_8)

| Case                                                                 | Result  | Notes                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release APK builds                                                   | F→fixed | **bug 1**: `lintVitalRelease` failed on `values-b+uz/ru/strings.xml` (iOS keys)                                                                                              |
| Sign-in in uz (rider A) and in ru (rider B), name step               | P       | "Как вас зовут?", "Продолжить / Пропустить"                                                                                                                                  |
| Language switch in the profile → every screen in Russian             | P       | home, search, picker, order sheet (classes, options, payment), ride, chat, summary, tips, promos, history, cargo sheet; plural "1 поездка" on the driver card; no overflow   |
| Order sheet: Ekonom, Komfort, Miniven, Biznes after enabling         | P       | 7 000 / 8 800 / 9 800 / 13 300–13 400; with stops 9 000 / 10 800 / 11 800; "6 kishigacha" on Miniven                                                                         |
| Add 1–2 intermediate stops by coordinates, price per stop            | P       | "Oraliq manzil 1: Baseyn, Guliston", 3,4 km, 9 000 so‘m, the rules sentence                                                                                                  |
| Searching panel: route with numbered stops                           | P       | "1. Baseyn, Guliston · Oldinda" (r02)                                                                                                                                        |
| On the trip: ETA points at the next stop, not the drop-off (part 1)  | P       | "1-oraliq manzil: Baseyn, Guliston · ~3 daq", map-less "1-oraliq manzilgacha 790 m" (r03); then "Mashina shu yerda kutmoqda"; then "Gulistan · ~6 daq"                       |
| Numbered stop markers / stop list on the ride screen (part 1)        | F→fixed | **bug 2**: the live screen's stop rows showed the badge only (r26 before, r25 after)                                                                                         |
| Change stops after the order: remove the 2nd stop, preview, confirm  | P       | 9 000 → "Yangi narx 8 000 so‘m (avval 9 000 so‘m): −1 000 so‘m", "Tasdiqlash — 8 000 so‘m", "Manzillar o‘zgartirildi" (r04–r06); the driver's alert at once                  |
| Waiting at a stop priced after the free minutes                      | P       | 3½ min at stop 1: "Pullik kutish +500 so‘m · naqd jami 8 500 so‘m" (r07); receipt "Oraliq manzillar × 1", "Pullik kutish 500", Jami 8 500 (r08)                              |
| Rating with a tag, cash tip 2 000                                    | P       | "Rahmat! 2 000 so‘m choychaqani haydovchiga naqd bering" (r09); the driver's done screen says so                                                                             |
| Order for another person (ru): validation, passenger on the ride     | P       | "Укажите телефон пассажира" when empty; summary "Пассажир: Karim · +998 97 700 01 99"; SMS to the passenger in the console log (car, plate, driver's phone, share link)      |
| Chat with quick replies both ways, unread badges, read receipts      | P       | driver "Уже еду, скоро буду" → rider "Написать водителю, новых сообщений: 1"; rider "Выхожу" → driver badge 1; "Прочитано" both ways (r13, r14)                              |
| Promo GULISTON: enter, discounted prices on the cards, order Miniven | P       | "GULISTON добавлен…", "Скидка 50%, до 10 000 сум"; Эконом 7 000 → 3 500, Минивэн 9 800 → 4 900, "Промокод GULISTON −3 500" (r17); ride 4 900, receipt with the line (r18)    |
| … driver cash-to-collect and compensation after completion           | API     | bot: `cash=4900`; `driver/earnings`: fares 9 800, cash 4 900, promoCompensation 4 900, net 9 702                                                                             |
| Referral: rider C enters B's code, first ride, B's reward            | API + P | C's quote: "Do‘st taklifi" 50% (4 900 off); after C's ride B's wallet: credit 10 000, "Приглашено: 1 · бонус получен: 1"                                                     |
| Ride credit spent on the next rides, the driver made whole           | P       | Бизнес 13 300 → 6 700 "Бонус −6 600" (history 6 700); then Эконом with 3 400 credit: the driver's done screen "Цена 8 000 − бонус пассажира 3 400 + прошлая поездка 3 000"   |
| Card ride (Biznes): awaiting payment, Payme test, dispatch after pay | P       | "Ожидание оплаты · 13 300 сум · 9:55" (r19); paid through the RPC → searching → the business bot; "Оплачено картой · Предоплата: 13 300 сум"                                 |
| Card tip 5 000 after the card ride                                   | P       | "Спасибо! Чаевые 5 000 сум оплачены картой и полностью достанутся водителю" (r20); `tipsCard: 5000` on the driver's earnings                                                 |
| History shows what the rider paid                                    | F→fixed | **bug 3**: the promo ride was listed as 9 800 (the rider paid 4 900) (r24 after)                                                                                             |
| Cancel after the free waiting: warning, fee, owed-fee line next time | P       | "При отмене водителю будет начислено 3 000 сум" (r22); "Плата за отмену: 3 000 сум"; next quote "За прошлую отменённую поездку +3 000 сум" (r23); collected on the next ride |
| Cargo sheet in Russian                                               | P       | "Малый грузовик 35 000 сум · до 700 кг · 10 км и 20 мин включены…" (r21)                                                                                                     |
| Unpaid card order cancelled free                                     | P       | #10051 cancelled while awaiting payment, nothing charged                                                                                                                     |

### Driver (Tablet_11, landscape)

| Case                                                           | Result  | Notes                                                                                                                                                          |
| -------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release APK build                                              | F→fixed | **bug 1** (same as the rider)                                                                                                                                  |
| Kept sign-in from wave 4, online, GPS                          | P       | "GPS yaxshi · ±8 m" once the test providers fed the tablet                                                                                                     |
| Offer with 2 stops (broadcast badge, pickup ETA, rider rating) | P       | "1-oraliq manzil Baseyn, Guliston", "2-oraliq manzil", "Manzil · 3,4 km" (d01)                                                                                 |
| Ride screen: stop list with the stops, passenger card          | P       | (d02); the orderer's rider card below the passenger card                                                                                                       |
| Rider changed the stops mid-trip: alert + list + cash update   | P       | "Yo‘lovchi manzillarni o‘zgartirdi — Endi 1 ta oraliq manzil. Yo‘lovchidan naqd 8 000 so‘m olinadi." (d03); the list and the cash card followed                |
| Stop card: "1-oraliq manzilga yetdim" → "Davom etish"          | P       | (d04); after 3½ min "Narx 8 000 so‘m + kutish 500 so‘m" (d05); done screen 8 500, tax −85, "Sizga qoladi 8 415" (d06), "Yo‘lovchi 2 000 so‘m choychaqa beradi" |
| Language switch → every tab in Russian                         | P       | Линия, Доход, Межгород, Рейтинг, Профиль (d07, d13); offer "До клиента 2,9 км · ~7 мин", chips "Наличные · Эконом · Для другого человека: Karim" (d08)         |
| Order for another person: passenger card, call, orderer        | P       | "Пассажир (заказ для другого человека) Karim · Заказчик: …" (d09)                                                                                              |
| Chat: quick replies, badge, read receipts                      | P       | (d10, d11)                                                                                                                                                     |
| Done screen in Russian, with the rider's bonus and an owed fee | P       | (d12); "Компенсация бонуса (на баланс) 3 400 сум", "(из них 3 000 сум — за прошлую отменённую поездку)" (d15)                                                  |
| Rider cancelled after the waiting → alert                      | P       | "Заказ #10054 отменён … плата за отмену будет начислена вам" (d14)                                                                                             |
| Off shift / on shift with the confirmation                     | P       | "Уйти с линии? Остаться / Уйти"                                                                                                                                |

### Earlier waves (API, `qa/wave4-smoke.mjs` against the running dev API)

20/20 checks passed: a shared ride with a second rider taken on the way, start codes, the
split prices and the driver's earnings, four people refused (1 front + 2 rear), a women-only
ride offered to the verified woman driver, a Yangiyer → Guliston seat ×2 = 20 000. Intercity
booking and trip publishing: by the API test suite (`intercity*.test.ts`) only in this run.

## Part 1: what was built

1. **ETA to the next stop.** `nextStopIndex` (`src/lib/stop-changes.ts`): the first unvisited
   stop, the one the car stands at, a skipped stop counts as behind once a later one was
   reached. The API's road ETA on the trip (`destinationEta`, `driver.location.destinationEtaS`)
   now targets that stop, with its own Redis key per stop (`stop:N`), and says which
   (`nextStopIndex`). The rider's header reads "1-oraliq manzil: … · ~3 daq" ("Mashina shu yerda
   kutmoqda" while the car stands there), the map frames the car with that stop and draws
   numbered pins (passed ones faded), the map-less fallback says "1-oraliq manzilgacha 790 m".
   A stream ETA for another stop than the one on screen gives way to the estimate (`etaFor`).
2. **Stops editable after the order.** Decision: allowed on a **cash taxi ride** at any stage
   that is on (scheduled, searching, a car on the way or waiting, the trip itself); stops the
   car already reached stay fixed (and any it skipped before them). Not allowed: card rides
   (the fare is prepaid; a second charge or a partial refund mid-ride would be needed — cancel
   and order again, the prepayment is refunded in full), shared rides and route seats, cargo
   and deliveries. `POST rides/:id/stops/preview` prices the new road with the same
   `computeFare` on the ride's own tariff snapshot and the night state of its order time (a
   route's fixed car price comes back when the last stop goes) and figures the reserved
   discount again by the same rules (`PromosService.reprice`: the code's percent and cap or
   the welcome discount, then credit up to its share and the rider's balance; a code that stops
   fitting drops out with the reason; a discount that falls to nothing is released). `PUT
rides/:id/stops` with `confirmTotal` (409 `price_changed` when the price moved) saves the
   stops, fare, distance and discount (credit changes are append-only `adjustment` rows on the
   ride: migration 0027 narrows the one-reservation-one-release index to those two kinds),
   records `stops_changed`, and emits `ride.stops_changed` → every screen refetches, the driver
   gets a push ("Yo‘lovchi manzillarni o‘zgartirdi") and an in-app alert with the new cash; the
   operator panel's timeline reads it. Rider UI: a stops box on the live ride screen with
   "Manzillarni o‘zgartirish" (`canChangeStops` from the API), a stops screen (add via the
   search / map picker with the `ride` param, remove, locked rows for reached stops), "Yangi
   narxni ko‘rish" → the price card → "Tasdiqlash — N so‘m".
   Tests: `src/lib/stop-changes.test.ts` (6), `test/ride-stops-change.test.ts` (5: preview /
   confirm / wrong total / push in the device's language / timeline; the trip with reached
   stops and the ETA target; refusals; promo percent and a code dropping out; credit up to
   half and the balance), rider `lib/stops.test.ts`, driver `lib/stops.test.ts`.

## Bugs found and fixed

| #   | Where      | Bug                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | both apps  | **Release builds failed** since the language layer (b374af9): `expo.locales` wrote the iOS `InfoPlist` keys (`NSLocationWhenInUseUsageDescription`, …) into Android's `values-b+uz/ru/strings.xml`, and `lintVitalRelease` stops a release on `ExtraTranslation` ("translated here but not found in default locale", 8 errors). The locale files now keep those keys under `ios`, which Expo writes to iOS only. |
| 2   | rider      | The live ride screen's stop rows showed the numbered badge without the address: the box was shrink-wrapped (`alignItems: 'flex-start'`), so the flexed text had no width. The box stretches, the button keeps to the left.                                                                                                                                                                                       |
| 3   | rider      | The history listed a promo ride at the full fare (9 800) although the rider paid 4 900: `historyAmount` takes the discount off (owed fees stay on), unit-tested.                                                                                                                                                                                                                                                 |
| 4   | QA tooling | The driver bot stopped taking offers after 15 minutes (the access token expired, 401 read as "no offers"); it signs in again on 401 and refreshes its position every 10 s (a quiet car is not offered to and not "nearby" on the class cards).                                                                                                                                                                   |

Verified on the devices after the fix: 1 (both APKs built and ran), 2 (r25), 3 (r24).

Tests: API 411 passed (56 files, `TEST_DB_NAME=taxi_test TEST_REDIS_DB=5`; a run made while
Gradle was building timed two timing tests out at 20 s — the dispatch cascade and the delivery
— they passed alone and in the final run), rider 295 (+3 skipped smoke), driver 267, web 182. `npm run typecheck`, `rtk proxy npx eslint .`,
`rtk proxy npx prettier --check .`: clean.

## Open issues

1. **Vehicle colour is free text in Uzbek** ("oq", "qora"): a Russian rider reads "qora Malibu",
   "Oq Chevrolet Cobalt". A colour quick-pick in the driver wizard (a fixed list in both
   languages) would fix it for new cars; existing cars need an operator's edit.
2. **Fixed (polish, 2026-10-16).** Promo descriptions were operator text in Uzbek only:
   GULISTON's "Ochilish aksiyasi: birinchi safarga 50% chegirma" showed in the Russian wallet.
   `promo_codes.description_ru` (migration 0028), the panel's "Tavsif (ruscha)" field, the API
   answers in the request's language with the Uzbek text as the fallback (wallet, quote,
   `promos.test.ts`); the campaign carries "Акция к открытию: скидка 50% на первую поездку
   (до 10 000 сум)" (`launch-campaign.test.ts`). Other operator-entered texts riders see are
   listed under "Operator texts and languages" below.
3. Rider names stored before the whitespace fix (wave 4, bug 15) still carry a double space
   ("Madinaxon Abdulazizova Nurmuhammad qizi") in the driver's cards and the complete dialog;
   a one-off `UPDATE users SET full_name = regexp_replace(full_name, '\s+', ' ', 'g')` before
   launch cleans it (the dev accounts only, in production there are none yet).
4. **Fixed (polish, 2026-10-16).** The history row of a ride cancelled free showed the ride's
   price ("Заказ отменён, 35 000 сум"). The rider's history now shows what was paid:
   "Bepul bekor qilindi" / "Отменён бесплатно" for a free (or waived) cancellation, the fee
   with the caption "Bekor qilish puli" / "Плата за отмену" otherwise (`historyAmountText`,
   unit-tested; the API's list already carried `cancellationFee` 0, now asserted in
   `qa-followups.test.ts`). The driver's history names a card ride's fee too (it had no cash
   state and was left out); the panel's ride tables grey a cancelled ride's price and say
   "bepul bekor qilindi" or "bekor puli 3 000 so‘m · qarz …" under it (`cancelledFeeLine`).
5. The uz `stopRules` sentence now says stops can be changed later on a cash ride; the API also
   allows it on a scheduled ride before its time — fine, but the deposit case (rides for later)
   refuses a new price below the deposit; not exercised on a device.
6. Dispatch timing on the emulators: a direct offer expires in 15 s, which is too short for
   screenshot-then-tap; several rides were assigned by the operator API instead. By design.
7. Push on the emulators: the apps have no EAS project id, so the worker's pushes are
   "skipped: no device" (the push text and routing are covered by `ride-stops-change.test.ts`
   and `notifications.test.ts`); the driver's local "Новый заказ" notification did show.

## Operator texts and languages (polish, 2026-10-16)

Texts operators type that riders and drivers read, and what a Russian app gets:

| Text                                                                    | Russian app                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Promo code description                                                  | `description_ru` when written, else the Uzbek text (fixed above)                                                                                        |
| City names (`cities.name_ru`)                                           | `city.name` of the quote / geocoding payloads follows the request language (both names stay in the payload)                                             |
| Intercity towns (`intercity_points`)                                    | the apps show `nameRu` in Russian (`townName()` in both apps' `lib/intercity.ts`); push and SMS about a trip name the towns in the recipient's language |
| Vehicle colour                                                          | a fixed list with a code per colour, shown in the app's language (open issue 1)                                                                         |
| Intercity meeting point (one text)                                      | **as typed** (Uzbek): one free-text field per town; operators may write it bilingually ("Vokzal / Вокзал")                                              |
| An operator's cancel reason, complaint answers, a driver's trip comment | **as typed**: free text from the person who wrote it, shown in the summary / push; system reasons are translated                                        |
| Place names from geocoding                                              | not operator text; unchanged by this work                                                                                                               |

## Needs the founder

- Store accounts (Google Play Console, App Store Connect) and the signing keys; the first
  production build needs `GOOGLE_MAPS_API_KEY`, the EAS project id and `google-services.json`.
- SMS templates (Eskiz/Play Mobile) approved before production: the passenger SMS for rides
  ordered for someone else, the stops-change push text is push-only (no SMS).
- Legal placeholders on the landing site and in the stores (offer, privacy policy, the
  fiscal/licence texts in `docs/fiscal-and-licence.md`).
- The regulator's answer on minivans (6–7 seats as M1 cars under Resolution 200): the class
  stays switched off in production until then; an operator approves every minivan after an
  inspection.

## Test data and cleanup

QA accounts +998977000102/104/105, 111–114 and their rides (#10046–#10059), the GULISTON code,
the referral and the credit rows stay in the dev DB (like the earlier waves'); every driver is
off shift. API/worker, the bots, the GPS feeder and the keep-awake loop were stopped by PID;
the tablet's test providers were removed and `mock_location` set back; both AVDs (started by
this run) were shut down; the generated `android/` folders are ignored by git and were removed,
Gradle daemons stopped.

## Screenshots (`qa/wave5/`, half size)

`r*` rider, `d*` driver. Key ones: r01 the order sheet with two stops, r03 the ETA to the next
stop, r04–r06 editing the stops with the priced confirmation, r07 paid waiting at a stop, r08
the receipt, r13/r14 chat badges and receipts, r17 the GULISTON discount on the class cards,
r19 awaiting payment (Payme test), r20 the card tip paid, r22/r23 the cancel fee and the owed
fee on the next quote, r24 the history after bug 3, r25/r26 the stops box after/before bug 2,
d01 the offer with stops, d03 the driver's alert when the rider changed the stops, d05 the
stop waiting fee, d08 the offer in Russian for another person, d15 the done screen with the
bonus compensation and the owed fee.
