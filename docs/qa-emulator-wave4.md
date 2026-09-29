# Emulator QA: wave 4 (rider and driver apps, Android)

Date: 2026-09-29/30 (night, Tashkent). Scope: the wave-4 features of
[shared-rides.md](shared-rides.md) — shared rides ("Hamroh bilan"), passengers and the seating
rule, the woman-driver option, start codes, fixed route prices, deposits for rides later and
trip-board seats, cargo and delivery — on real devices, with the apps built as release APKs
against the real API and worker.

Branch `wave4-qa` (worktree `D:\sff-taxi-wt-qa`), 18 fix commits plus a merge of `main`
(5359285, load-test perf fixes), not pushed or merged.

Result: **17 bugs fixed** (API 3, rider 7, driver 5, two spanning the API and an app), with unit
or API tests where logic was involved; 10 re-verified on the devices, the rest by tests. No
crash, no JS error in `logcat`. The emulator clocks stayed correct the whole run (keep-awake
held; see "How it was run").

## How it was run

- **Devices** (already running, reused, not restarted): `emulator-5554` Pixel_8 (rider A),
  `emulator-5556` Tablet_11, landscape (driver), `emulator-5558` Phone_Operator (rider B for the
  shared car; the image allowed installing). All API 37 with Google Play.
- **APKs**: as in [qa-emulator-report.md](qa-emulator-report.md): `expo prebuild --platform
android --clean` once, then `gradlew assembleRelease -PreactNativeArchitectures=x86_64`
  (JBR from Android Studio, `ANDROID_HOME` set), `EXPO_PUBLIC_API_URL=http://10.0.2.2:3200`,
  the cleartext plugin, no Google Maps key (map-less fallback). First build ~10 min per app;
  rebuilds after fixes only re-run Gradle in the kept `android/` folder (~3 min, JS bundle
  only). `D:\sff-taxi-wt-qa` was short enough for CMake. `adb install -r` keeps the sign-in.
- **Backend**: the dev DB (`taxi` on :5460, migrations up to date incl. 0018), API :3200 and
  worker :3201 from `apps/api` (`node --env-file=.env dist/main.js` / `dist/worker.js`) with
  extra env: `OTP_FIXED_CODES` (+998900000001 and +998977000101…120 : 111111), `PAYME_TEST=true`,
  a dummy `PAYME_MERCHANT_ID` (24 hex) and `PAYME_KEY`, S3 on :8335 (bucket `taxi-qa-w4`,
  public endpoint `http://10.0.2.2:8335`). Rebuilt and restarted after each API fix and after
  merging `main`. Deposits were paid through the API's Payme JSON-RPC (Create + Perform, like
  `test/payments-helpers.ts`), and the apps updated live.
- **UI driving**: `adb shell input`, `uiautomator dump`, `screencap` through small Node helpers
  (no Python). **Pitfall**: `uiautomator dump` waits for the UI to go idle and returns a _stale_
  tree on screens that animate (offer countdown, waiting timer, the searching pulse); those
  were read from screenshots and tapped by coordinates. Typing right after a tap sometimes
  lands before the field is focused: wait ~1.5 s. On Phone_Operator Gboard's stylus tutorial
  swallows the first input (dismiss it once).
- **GPS**: test providers `gps` and `network` fed every ~2 s by a Node feeder that walks towards
  a target at a set speed (or jumps). Fused location follows the mock well when moves are
  realistic.
- **Accounts**: rider A +998977000102 (46-char name "Madinaxon Abdulazizova Nurmuhammad
  qizi"), rider B +998977000103 (app) / +998977000101 (API), taxi driver +998977000111
  "Qodirov Sherzodbek Abdumalikovich" (Cobalt, applied in the app), cargo driver
  +998977000112 "Toshmatov Bobur Anvarovich" (Damas, applied in the app). Documents were set
  through the API (the photo upload flow passed in the previous run); licence check, gender
  and approval by the operator through the API.
- **Keep-awake**: a `SetThreadExecutionState` PowerShell loop during the run (the previous run
  lost both emulators to the PC's idle sleep).

## Test matrix

P = passed on the device; F→fixed = failed, fixed and re-verified on the device; F→fixed\* =
failed, fixed, verified by tests only; API = through the API only; note = passed with a remark
(see "Open issues").

### Rider (Pixel_8, and Phone_Operator for rider B)

| Case                                                           | Result        | Notes                                                                                                                                                              |
| -------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-in (fixed code), long name, location and push permissions | P             | name step, "While using the app", push prompt after the first order                                                                                                |
| Home: Taksi · Yuk · Yetkazish switch, chips, route chips       | P             | "Yukni qayerga?", "Posilkani qayerga?"; route chips from the rider's town (Guliston → Toshkent / Yangiyer; Yangiyer → Guliston)                                    |
| "Mening joylashuvim" after moving (mock GPS)                   | F→fixed       | **bug 2**: the button never reacted; after the fix 40.502 → 40.50489 on tap (r26)                                                                                  |
| Passenger stepper 1–3                                          | P             | stops at 3, "oldinda 1, orqada ko‘pi bilan 2"                                                                                                                      |
| "Hamroh bilan": discount note, cars on the way                 | F→fixed       | **bug 1**: no car was ever "on the way" without a router; after: "Yo‘lingizda mashina bor · ichida 1 kishi, 2 bo‘sh joy (orqada 2), ~1 daq" (r04)                  |
| … car hidden when the rider's people do not fit                | P             | 2 people, car with 1 free seat: not listed                                                                                                                         |
| Female-driver row: disabled → gender in profile → enabled      | P             | 30-day lock dialog, "Keyingi o‘zgartirish: 30 oktabr"                                                                                                              |
| Start code on the ride screen                                  | P             | night + shared: 4 big digits                                                                                                                                       |
| Live car distance / ETA (map-less)                             | P             | "Taksi sizdan 180 m → 10 m", "~1 daq"; cargo said "Taksi" (**bug 14**)                                                                                             |
| Price change when a co-rider joins                             | P             | live 15 600 → 13 300 "Hamroh chegirmasi −2 300" (r09); B 27 600 → 24 500                                                                                           |
| Paid waiting shown during the trip                             | F→fixed\*     | **bug 4**: rider saw 15 600, driver asked 19 100                                                                                                                   |
| Completion, receipt lines, rating                              | P             | "Pullik kutish 3 500", "Hamroh chegirmasi −2 300", Jami 16 800; "Sherzodbek bilan…", tags, "Rahmat!"                                                               |
| Route seat price Yangiyer → Guliston (GPS in Yangiyer)         | F→fixed\*     | seat 10 000/kishi, ×2 = 20 000; tariff cards said "o‘rindiq 21 500" (**bug 11**)                                                                                   |
| Ride for later with deposit: quote, order, pay, live update    | P / F→fixed\* | 5 000 deposit, "qolgan 10 600 naqd", 10-min timer; paid via Payme RPC → "Oldindan buyurtma" at once; "To‘lov naqd" copy (**bug 8**)                                |
| … operator cancels: deposit refunded                           | API           | intent `refund_pending`                                                                                                                                            |
| Cargo sheet: classes, loaders, weight, validation              | P             | 900 kg switches to O‘rta, 2 000 kg "Ko‘pi bilan 1500 kg" + button disabled; loader +30 000                                                                         |
| Cargo order → cargo car offer → accept                         | P             | Damas got it with class, loader, 300 kg, "muzlatkich"                                                                                                              |
| Delivery sheet: recipient validation, weight limit             | P             | "Qabul qiluvchining ismini yozing", "telefonini yozing", "Ko‘pi bilan 10 kg", "Telefon raqami noto‘g‘ri"                                                           |
| Trip board: search incl. along the way, deposit booking, pay   | P / F→fixed   | Sirdaryo → Toshkent on a Guliston → Toshkent trip: "Yo‘l-yo‘lakay", 51 000 part price; deposit 11 000, paid → "Band qilingan"; driver named by surname (**bug 9**) |
| Offline banner and recovery                                    | F→fixed       | strip appears on the next request and clears with the connection; status bar unreadable under it (**bug 16**)                                                      |
| Large font (font_scale 1.3), long names                        | note          | wave-4 rows wrap well; landmark hint clipped (**bug 17**), availability truncated in class cards (full in the footer)                                              |

### Driver (Tablet_11, landscape)

| Case                                                    | Result      | Notes                                                                                                                                   |
| ------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in with the keyboard up                            | note        | the phone keypad hides "Kod olish" on the landscape tablet; the keypad's action key submits                                             |
| Wizard: taxi car (Cobalt), gender                       | P           | 3 steps, quick pick, plate formatted "20 A 345 QA"                                                                                      |
| Wizard: cargo car (Damas: body, payload)                | P           | "Nima tashiysiz?" → Yuk tashish → Damas: furgon, 550 kg, 1 400 kg, "Kichik yuk buyurtmalari"; API `cargo_s`                             |
| Approval via operator API → live                        | P           | push intro, tabs                                                                                                                        |
| Go online, GPS fixes sent                               | P           | "GPS yaxshi · ±6 m"; `admin/dispatch/live` position follows the mock route                                                              |
| Pool panel: toggle, people stepper (cap 3), destination | P           | stepper asks for a destination first, stops at 3 ("bo‘sh joy yo‘q"), "→ Yangiyer" + clear chip (confirm, people back to 0)              |
| Cargo car shows passenger settings                      | F→fixed     | **bug 12** (d23 after)                                                                                                                  |
| Offers with along info and badges                       | F→fixed     | "Yo‘lingizda: +1 daq aylanish", stop list, Hamroh badge; "Mijozgacha 0 m" for an along offer (**bug 5**), after: 2,9 km                 |
| Accept, stop list with two riders, per-rider cash       | P           | "Mashinadagi yo‘lovchilar · Oldinda 1/1 · orqada 2/2"                                                                                   |
| Start with the PIN keypad: wrong, then right            | P           | "Kod noto‘g‘ri. Yo‘lovchidan qayta so‘rang."                                                                                            |
| … unlimited wrong codes                                 | F→fixed     | **bug 3**: after 5 wrong codes "Kod ko‘p marta noto‘g‘ri kiritildi. 15 daqiqadan keyin…" (d25)                                          |
| Second rider gets in                                    | F→fixed     | **bug 6**: "Buyurtma #10020 sizdan olindi — Unga bormang" with the rider in the car (d13); after: no alert (d26)                        |
| Complete each rider, cash lines                         | F→fixed     | 16 800 = 15 600 − 2 300 + 3 500 but the line left the waiting out (**bug 7**); after: "Narx 15 600 so‘m − hamroh chegirmasi 2 300 so‘m" |
| Cash lines with a deposit (trip board booking)          | P           | "Naqd: 40 000 so‘m" + "11 000 so‘m oldindan to‘langan", "Yo‘l ustida: Sirdaryo → Toshkent"                                              |
| Trip board publish: max 3 seats, max 2 rear             | P / F→fixed | 1–3 seats; front seat off → at most 2; empty board suggested "4 o‘rin" (**bug 10**)                                                     |
| Network off during a ride step → pending → on           | P           | offline strip, optimistic "Yo‘lovchini kuting", "Yuborilmoqda…", arrive reached the API when back online                                |
| Cargo offer wording                                     | F→fixed\*   | "Yo‘lovchi reytingi" on a cargo offer (**bug 13**)                                                                                      |

### Cross (two riders in one car, the tablet driving)

| Case                                                        | Result | Notes                                                                                                                              |
| ----------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Driver with 1 person without the app, heading to Yangiyer   | P      | front seat taken by the extra person                                                                                               |
| Rider A (Pixel) shared, rider B (Phone_Operator) on the way | P      | B saw the car "ichida 2 kishi, 1 bo‘sh joy (orqada 1)"; B offered along, accepted; both prices fell; A dropped first, B at the end |
| Founder's rule: never more than 2 in the back               | P      | with 1 extra + A + B: "Oldinda 1/1 · orqada 2/2 · bo‘sh joy yo‘q"; B with 2 people did not see the car; API refuses 4 (tests)      |
| Totals                                                      | P      | A 16 800 (15 600 − 2 300 + waiting 3 500), B 24 500 (27 600 − 3 100); the driver's done screens match                              |
| Re-run on the final builds                                  | P      | A (Pixel) + B (API): no false alert, cash line with the discount; six wrong codes on a third ride → paused                         |

## Bugs found and fixed

| #   | Where        | Bug                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Commit           |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | API          | **Shared rides never matched without a router** (`ROUTER=none`, the documented fallback): every leg of a car's plan was timed as a trip of its own with its first 5 km at city speed, so a stop right on the way to another town cost ~7 min of "detour". No car was ever "on the way" (quote `pool.cars` empty), no along offer. Estimated legs are now timed as one continuous drive (the unit test shows the old per-leg timing refused the same rider). | 906d4f5          |
| 2   | rider        | **"Mening joylashuvim" did nothing on Android**: the button sat above the bottom panel but inside it; Android delivers no touches outside a parent's bounds (the "stale pickup" of the previous run's bug 3). Now a sibling placed above the panel.                                                                                                                                                                                                         | 109a612          |
| 3   | API + driver | **The 4-digit start code could be tried through** (no limit). Five wrong codes per ride pause the start for 15 min (429, failures only, Redis); the keypad stays open with the reason instead of a generic alert.                                                                                                                                                                                                                                           | d213733, 3fac863 |
| 4   | rider        | During the trip the rider saw "15 600 so‘m · naqd" while the driver asked 19 100 (paid waiting left out). Now "Pullik kutish +3 500 so‘m · naqd jami 19 100 so‘m"; the deposit line counts the waiting too.                                                                                                                                                                                                                                                 | 27c84af          |
| 5   | API          | Along offers had `distanceM: 0`: "Mijozgacha 0 m · ~7 daqiqa" for a rider 3 km ahead. The insertion reports the road metres to the pickup.                                                                                                                                                                                                                                                                                                                  | 353c2e5          |
| 6   | driver       | **False "Buyurtma sizdan olindi — Unga bormang" alert** when the second rider got in (the current ride follows the next stop). A ride is taken away only when it is no longer one of the car's stops.                                                                                                                                                                                                                                                       | bf1a491          |
| 7   | driver       | The cash line of a shared ride dropped the paid waiting ("Narx 15 600, hamroh chegirmasi −2 300" under 16 800), on the ride and done screens. Every part is listed now.                                                                                                                                                                                                                                                                                     | f22bc59          |
| 8   | rider        | Rides for later said "To‘lov naqd" / "naqd to‘lov" next to a 5 000 card deposit.                                                                                                                                                                                                                                                                                                                                                                            | cc66c91          |
| 9   | API + rider  | The trip board ("first name only until booked") and the shared trip page showed the **surname** ("Qodirov"): drivers register "Familiya Ism Otasining ismi". The given name is the first word that does not look like a surname/patronymic.                                                                                                                                                                                                                 | 15baa2a          |
| 10  | driver       | Trip board copy: "4 o‘rin" example (max 3) and "seat paid in cash" (app bookings take a deposit).                                                                                                                                                                                                                                                                                                                                                           | e1ce76e          |
| 11  | rider        | On a fixed route (Yangiyer → Guliston, 10 000/seat) the class cards and the banner showed the tariff's seat share (21 500).                                                                                                                                                                                                                                                                                                                                 | ba92540          |
| 12  | driver       | A cargo car (Damas) got the passenger settings: "Hamroh yo‘lovchilar", people in the car, heading filter, women riders.                                                                                                                                                                                                                                                                                                                                     | 023c6d3          |
| 13  | driver       | Cargo/delivery offers said "Yo‘lovchi reytingi".                                                                                                                                                                                                                                                                                                                                                                                                            | 4c8b8ce          |
| 14  | rider        | Without a map a cargo car on the way was "Taksi sizdan 180 m".                                                                                                                                                                                                                                                                                                                                                                                              | cce9789          |
| 15  | API          | Names kept the keyboard's double space ("Abdulazizova Nurmuhammad") and showed so to drivers; whitespace is collapsed on PATCH me and the application.                                                                                                                                                                                                                                                                                                      | 7c3d18c          |
| 16  | rider        | The offline strip made the status bar unreadable (dark icons on black) and lay over the header; light status bar, touches pass through to the back button.                                                                                                                                                                                                                                                                                                  | af4c6da          |
| 17  | rider        | The pickup landmark hint wrapped inside the one-line field and was cut in half (even at font scale 1.0).                                                                                                                                                                                                                                                                                                                                                    | c850b84          |

Verified on the devices after the fix: 1, 2, 3, 5, 6, 7, 8, 9 (API), 12, 16; by tests (and
review) only: 4, 10, 11, 13, 14, 15, 17.

Tests: API 296 passed (38 files, `TEST_DB_NAME=taxi_test_2 TEST_REDIS_DB=14`), rider 219 (+3
skipped smoke), driver 209. `npm run typecheck`, `rtk proxy npx eslint .`, `rtk proxy npx
prettier --check .`: clean.

## Open issues

Closed after the run on branch `wave4-polish` (code and tests; not re-run on the emulators):

1. ~~**Trip board, along the way**: a rider boarding in Sirdaryo sees the trip's meeting point
   ("Guliston avtovokzali") and the full 132 km.~~ **Closed** (10b08bb, 7b90ec3). Product
   decision: the rider gets in at their own town's meeting point ("Sirdaryo markazi, bozor
   yonida") about when the car passes it (departure + the town's share of the driving time by
   distance, to 5 min, "taxminan 08:50") and gets off at their drop-off town's point; the
   distance is their part. API `boardingPoint`, `alightingPoint`, `partDistanceM` on bookings
   and along-the-way results; the rider's booking, trip screen and search cards and the
   driver's booking card show them.
2. ~~**Device geocoder language**: "улица Увайсий, Guliston", "M-34, Bayaut District" shown to
   the driver.~~ **Closed** (6ef3646). The API's reverse geocoding (uz) is used first, the
   phone's only without it; Cyrillic parts and plus codes are dropped, "District"/"Region" put
   in Uzbek; with nothing readable the order carries no address (the pin and the landmark
   do), never coordinates or "Mening joylashuvim".
3. ~~Tablet sign-in: the keypad covers "Kod olish" in landscape; date fields use the full
   keyboard.~~ **Closed** (1aad1cc): the form scrolls into view when the keyboard opens, the
   logo shrinks when little room is left; date fields use the number pad with automatic dots.
4. ~~Font 1.3: class-card availability cut to one line.~~ **Closed** (980502a): the cards say
   "Mashina ~4 daq" / "Mashina yo‘q" (one line, same height for each class), the footer and
   the screen reader keep the full sentence.
5. ~~The ride header "#10020 · Naqd · 2 yo‘lovchi" reads like that ride has 2 people.~~
   **Closed** (c76d324): "Bu buyurtmada 2 kishi · Mashinada jami 3 kishi"; the home card counts
   orders ("2 buyurtma").
6. ~~A cargo car's cab seats default to 4.~~ **Closed** (f6d83bc): the cargo quick picks set
   the real cab seats (Damas/Labo 1, Gazel/Porter/Isuzu 2), switching to cargo drops the
   taxi's 4; the app and the API accept 1–2 for a cargo car (`riderRides` stays 1).
7. ~~A ride for later whose search starts takes over the screen mid-order.~~ **Closed**
   (53d224e): it opens by itself only from the map; elsewhere a notice "Oldindan buyurtmangiz
   uchun haydovchi qidirilmoqda" shows below the header, a tap opens the ride.
8. ~~Rider cancelled while the start-code keypad was open: no "bekor qilindi" alert.~~
   **Closed** (5b90be2). Cause: the alert came only from the stream's `ride.status_changed`
   and only while the cached current ride was still that ride; a poll, a push or a
   reconnect that cleared it first left just "Faol safar yo‘q". The app now watches the
   current ride: a ride leaving the car without the driver ending it is looked up and
   announced once (cancelled or taken away), also for the other rider of a shared car.
9. Missed offers during the run lowered the test driver's priority 91 → 84 (dispatch rule,
   noted in the previous run too). Open: by design.

Tests after these: API 298 passed (38 files), rider 228 (+3 skipped smoke), driver 220; typecheck, eslint and
prettier clean.

## Test data and cleanup

QA accounts +998977000101–103, 111, 112 and their rides (#10015–10027), one intercity trip
(#5002, cancelled), two refunded deposits (`refund_pending`) stay in the dev DB, like the
smoke-test accounts before them; both drivers are offline. API/worker and the keep-awake loop
were stopped by PID; GPS test providers removed; Phone_Operator: rider app uninstalled and
`mock_location` back to `default`; Pixel_8 and Tablet_11 keep the new builds of the apps they
had and `mock_location` `allow` as found; font scale back to 1.0; generated `android/` folders
removed and Gradle daemons stopped.

## Screenshots (`qa/screens-wave4/`, half size)

`r*` rider, `d*` driver; `…-before` shows a bug before its fix. Key ones: r04 cars on the way,
r09 live price drop, r08 rider B seeing the car's free seats, r16/r17 deposit awaiting → paid,
r23/r25 board along the way and a paid booking, r26 my location fixed, d05/d10 along offers,
d11 stop list, d13 the false alert (before) and d26 (after), d12 offline arrive, d20 board
booking with deposit, d22 cargo offer, d23 cargo car without the passenger settings, d25 start
paused after wrong codes, r36 the ride-later copy and r37 the offline strip after their fixes.
