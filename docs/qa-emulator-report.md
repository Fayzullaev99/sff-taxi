# Emulator QA: rider and driver apps (Android)

Date: 2026-09-27. Apps: `apps/rider` (SFF Taxi, `uz.sff.taxi`) and `apps/driver` (SFF Taxi
Haydovchi, `uz.sff.taxi.driver`), Expo SDK 57 / React Native 0.86.3, tested as **release APKs**
(`expo prebuild --platform android --clean` + `gradlew assembleRelease`, x86_64, Hermes,
`EXPO_PUBLIC_API_URL=http://10.0.2.2:3200`, no Google Maps key, no EAS project id) against the
real API and worker built from `main` (084e8c0) on :3200/:3201 with the dev database, SeaweedFS
on :8335 (bucket `taxi-qa`), `SMS_PROVIDER=console`, `PAYME_TEST=true` with a dummy merchant.

Branch `qa-mobile` (worktree `D:\tq`), 8 commits on top of `main`, not pushed or merged.

Devices: **Pixel_8** (phone, 1080×2400, three-button navigation) for the rider app and
**Tablet_11** (2560×1600, landscape, gesture navigation) for the driver app, both API 37
(Google Play images), both already running and reused.

Result: **15 app bugs fixed** (unit tests where logic was involved), **4 API findings**, no JS
errors in `logcat`; the only fatal crash was bug 2 (fixed). **The run was cut short**: at
18:04:51 the host PC went into idle S3 sleep; after resume both emulators' guest clocks loop
over the same 40 s window (uptime rewinds every ~40 s), timers never fire, the apps freeze and
system services drop (`Broken pipe`). Restarting the shared emulators (or starting own AVDs)
was not permitted in this session, so the rest of the plan was covered through the API, code
review and unit tests; see "Not run on the device".

## How it was run

- APKs installed with `adb install -r`; UI driven with `adb shell input`, read with
  `uiautomator dump`, screenshots with `adb exec-out screencap -p`.
- Test data: a rider (`+998 91 111 22 01`, 46-character name) and a driver applicant
  (`+998 91 111 22 02`, "Qodirov Sherzodbek Abdumalikovich") signed in through the apps with
  SMS codes read from the API log; operator actions (licence check, reject, appeal answer,
  approve) through the API with the operator's token; documents: 9 PNGs pushed to the tablet's
  `Pictures` and picked in the system photo picker.
- **GPS**: fed through the Android location test providers (`gps`, `network`) every 2 s after
  `appops set com.android.shell android:mock_location allow`. Google Play services' fused
  provider rejects big jumps ("location delivery blocked - too fast"), so moves were kept
  realistic (a few hundred metres).
- Rebuilds: v0 (as on `main` + cleartext plugin), v1 (map fallback, push, driver keyboard), v2
  (all commits up to 2da6cd3). Commits f263934 and 0fb96b7 were made after the emulators broke
  and are verified by typecheck/unit tests only.

## Test matrix

P = passed, F→fixed = failed, fixed and re-verified on the emulator, F→fixed\* = failed, fixed,
**not** re-verified on the emulator (unit-tested / reviewed), API = exercised through the API
only (the device part blocked), — = not run.

### Rider app (Pixel_8)

| Case                                                               | Result    | Notes                                                                                                          |
| ------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------- |
| Sign-in: phone, wrong code, correct code, name step (long name)    | P         | "Kod noto‘g‘ri yoki muddati o‘tgan"; "Salom, Abdulazizxon!"                                                    |
| First launch after sign-in (map)                                   | F→fixed   | crash `API key not found` (bug 2); map-less home since v1                                                      |
| Location permission, start at the rider's position                 | P         |                                                                                                                |
| Outside the service area (Tashkent)                                | P         | "Bu hududda hozircha ishlamaymiz … Guliston, 93 km"; "Qayerga?" disabled; wording without a map: bug 5 (\*)    |
| "Mening joylashuvim" after moving                                  | F→fixed\* | kept the old place (bug 3); v2 still stale on the emulator, v3 (high accuracy) not built                       |
| Pickup/destination address text                                    | F→fixed   | Google plus codes "FQVJ+FCW, Gulistan" (bug 4); v2: "Gulistan"                                                 |
| Destination search (`GEOCODER=none`)                               | P         | "Manzil qidiruvi hozircha ishlamayapti — joyni xaritada belgilang."                                            |
| Destination by map pick (map-less picker, typed coordinates)       | P         | coordinates apply ~0.7 s after typing                                                                          |
| Tariff cards: fixed price, nearest car ETA                         | P         | Ekonom 7 000 so‘m "~4 daq", Komfort 8 800 so‘m "Yaqinda bo‘sh mashina yo‘q"                                    |
| Options with prices, landmark, comment                             | P         | keyboard covered the comment (bug 7, \*)                                                                       |
| Cash order → searching → driver assigned                           | P         | live distance "Taksi sizdan 1,1 km → 510 m", ETA "4 → 2 daq", plate, car, driver                               |
| Arrived: free waiting countdown, then paid waiting                 | P         | "Bepul kutish: 0:35", "Pullik kutish: 1 daq · 500 so‘m"                                                        |
| In progress: destination distance and ETA                          | P         | "Manzilgacha 1,9 km", "~7 daq"                                                                                 |
| Share link, SOS confirmation                                       | P         | system share sheet with `https://taxi.sff.uz/t/…`; SOS dialog, cancelled                                       |
| Completed: fare lines, rating with tag and comment                 | F→fixed\* | total 7 500 (7 000 + waiting 500) OK; prompt used the surname "Qodirov bilan…" (bug 8)                         |
| Push permission prompt after the first order                       | F→fixed   | never asked on Android 13+ (bug 6); v1: system prompt right after the order                                    |
| Cancel while searching (free, with reason)                         | P         | "Haydovchi hali topilmadi. Bekor qilish bepul."                                                                |
| Cancel after the free waiting: fee warning                         | P         | "… 3 000 so‘m to‘lov haydovchiga yoziladi. U keyingi naqd safaringiz narxiga alohida qo‘shiladi."              |
| Owed fee on the next quote                                         | P         | "Oldingi bekor qilingan safar uchun +3 000 so‘m", total 10 000 so‘m                                            |
| Card payment: awaiting payment, Payme checkout, check, free cancel | F→fixed\* | Payme test page opens in a custom tab (the sandbox itself answers 502); "To‘ladim — tekshirish" silent (bug 9) |
| Ride for later (quote, order, list, cancel; card refused)          | API       | see API findings (1)                                                                                           |
| Intercity search, seat booking, cancel rules                       | API       | booked front seat 80 000, free cancel till 1 h before, driver's contact and plate                              |
| Complaint with a photo, saved/recent places, offline banner        | —         | blocked (emulators broken)                                                                                     |
| Forced update (`MIN_RIDER_APP_VERSION=9.9.9`)                      | API       | `/config` returns `minAppVersion.rider = "9.9.9"`; the app's compare is unit-tested                            |
| Back button (ride summary → exits the app, it is the stack root)   | P         |                                                                                                                |
| Tablet / landscape                                                 | —         | blocked                                                                                                        |

### Driver app (Tablet_11, landscape)

| Case                                                                 | Result    | Notes                                                                                                     |
| -------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| Sign-in with the keyboard up                                         | F→fixed   | "Kod olish" under the keyboard (bug 10)                                                                   |
| Application wizard (3 steps, long name, PINFL, licence, car, CNG)    | F→fixed   | keyboard covered the PINFL field and the footer (bug 10); v1: fields and footer above the keyboard        |
| Documents: selfie, car photo, 7 documents from the gallery           | P         | 9 uploads to SeaweedFS with progress, "Yuklangan"                                                         |
| Operator licence check (API) → status screen                         | P         | "Reyestrda tasdiqlangan" (after the next refetch, see API finding 2)                                      |
| Operator rejects → live; appeal; operator answers → live             | P         | "Ariza rad etildi" + reason; appeal "Ko‘rib chiqilmoqda" → "Javob berildi" with the answer                |
| Resubmit, operator approves → tabs                                   | P         |                                                                                                           |
| "Why notifications" step after approval, system prompt               | F→fixed   | never shown on Android 13+ (bug 11)                                                                       |
| Go online: location permission, GPS indicator, promo, today          | P         | "GPS yaxshi · ±8 m", "31.12 gacha 0% komissiya"                                                           |
| Offer: countdown ring, notification sound, fare, pickup ETA, comment | P         | 15 s; "Mijozgacha 1,5 km · ~4 daqiqa", landmark, comment, rider rating                                    |
| Accept → ride; navigator choice → Google Maps                        | P         | choice remembered                                                                                         |
| Arrive: free/paid waiting timer; start; complete with confirmation   | P         | "Yo‘lovchidan 7 500 so‘m oling"; done screen: cash big, commission 0 %, tax 1 % −75, "Sizga qoladi 7 425" |
| Rate the rider                                                       | P         |                                                                                                           |
| Rider cancelled after the waiting → alert                            | P         | "Buyurtma #10005 bekor qilindi … bekor qilish haqi sizga yoziladi"                                        |
| Money screen, card top-up (Payme page), pending state                | F→fixed\* | expiry "13:09" shown at 17:39 Tashkent on the UTC emulator (bug 12); "so‘m dan … so‘m gacha" (bug 13)     |
| Missed offers                                                        | P         | two missed offers lowered "Ustuvorlik" 91 → 88 → 85; the same ride is not offered again                   |
| Decline with reason                                                  | API       | reasons from `/driver/config`                                                                             |
| Intercity publish / edit before booking / boarding / cancel          | API       | edit after a booking 409, boarding before the window 409 (see finding 3)                                  |
| Cash to collect incl. an owed fee, passes, offline strip, background | —         | blocked (the emulators broke right before)                                                                |
| Tab bar with three-button navigation (phone)                         | F→fixed\* | fixed height dropped the inset (bug 14), same as SFF Eats bug 16; not run on the phone                    |

`adb logcat`: no `FATAL`/`AndroidRuntime` errors except bug 2's crash, no JS errors; only the
expected "no EAS projectId configured" push warning.

## Bugs found and fixed

| #   | App    | Bug                                                                                                                                                                                                                                               | Commit           |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | both   | Release APKs for an `http://` API failed every request (Android blocks cleartext): config plugin enables `usesCleartextTraffic` only when `EXPO_PUBLIC_API_URL` starts with `http://`.                                                            | 19b1eba, f97dae5 |
| 2   | rider  | **Crash right after sign-in** in builds without `GOOGLE_MAPS_API_KEY`: react-native-maps' MapView is Google's even with OSM tiles. `extra.androidMapsKey` + map-less home, point picker (coordinates, "my location") and ride map (car distance). | f97dae5          |
| 3   | rider  | "Mening joylashuvim" returned a stale position (cached last-known / balanced fix). Explicit taps now ask for a fresh high-accuracy fix first.                                                                                                     | f97dae5, f263934 |
| 4   | both   | Device-geocoder fallback put Google plus codes in addresses ("FQVJ+FCW, Gulistan"), also seen by drivers; dropped (`deviceAddressLine`, unit-tested).                                                                                             | f97dae5          |
| 5   | rider  | Without a map the out-of-area notice and the search still said "move the pin"; wording follows the map mode (unit-tested).                                                                                                                        | f97dae5          |
| 6   | rider  | **Push permission never asked on Android 13+** (`denied` + `canAskAgain` for a never-asked permission); `pushPermissionState` (unit-tested).                                                                                                      | 97f6996          |
| 7   | rider  | Keyboard covered the order screen's comment (Android 15+ edge to edge, `KeyboardAvoidingView` off on Android): `KeyboardAvoider` on order, sign-in, complaints, intercity booking and the ride summary's rating comment.                          | bb741aa, 0fb96b7 |
| 8   | rider  | Rating prompt addressed the driver by the surname ("Qodirov bilan…"): drivers register "Familiya Ism Otasining ismi"; `driverGivenName` (unit-tested).                                                                                            | 3615ae0          |
| 9   | rider  | "To‘ladim — tekshirish" gave no feedback when the payment had not arrived; spinner + "To‘lov hali kelmadi…".                                                                                                                                      | f263934          |
| 10  | driver | **Keyboard covered the sign-in button and the application wizard** (tablet): the `Screen` wrapper pads by the keyboard height on Android.                                                                                                         | 2da6cd3          |
| 11  | driver | **"Why notifications" step never appeared on Android 13+**; `pushPermissionState` keeps a never-asked permission askable until the intro was shown (unit-tested).                                                                                 | 2da6cd3          |
| 12  | driver | Times in the device's zone (top-up expiry, payments, documents, appeals, pass end) instead of Tashkent like the rest of the app; `time`/`dateTime`/`passLabel` (unit-tested).                                                                     | 2da6cd3          |
| 13  | both   | "5 000 so‘m dan … so‘m gacha", "7 000 so‘m ni" → "so‘mdan", "so‘mgacha", "so‘mni".                                                                                                                                                                | 2da6cd3, f263934 |
| 14  | driver | Tab bar height fixed at 68 dropped the bottom inset (three-button navigation), as in SFF Eats.                                                                                                                                                    | 2da6cd3          |
| 15  | rider  | Coordinate fields of the map-less picker use the decimal keypad.                                                                                                                                                                                  | f97dae5          |

Checks on the final branch: `tsc` (both apps), `rtk proxy npx eslint apps/rider apps/driver`,
`rtk proxy npx prettier --check apps/rider apps/driver`: clean. Vitest: rider 134 passed
(+3 skipped smoke), driver 136 passed (new: map support, coordinates, plus codes, area wording,
push permission ×2, driver given name, Tashkent times, pass label).

## API findings (apps/api not changed)

1. **`POST /v1/rides/quote` with `scheduledFor` lists `paymentMethods: ["cash","card"]`**, but
   ordering it by card answers 400 "Oldindan buyurtma hozircha faqat naqd to‘lov bilan". The
   rider app hides card for rides for later itself; the quote should say `["cash"]`.
2. **A licence check (`POST /admin/drivers/:id/licence`) is not pushed to the driver**: the
   status screen kept "Litsenziya kartochkasi tekshirilmoqda" until its next refetch (the
   rejection a minute later arrived live). Suggest emitting `driver.updated` for it.
3. Error bodies are not uniform: the boarding-window 409 has `message/key/params` without
   `error`/`statusCode` (other 409s have them). Harmless for the apps (they read `message`).
4. A driver who misses an offer is not offered the same ride again and loses 3 priority points
   per miss; with a single online driver the rider waits for "no driver". Intended per
   dispatch rules, noted because it made the first two orders look stuck.

External: `https://checkout.test.paycom.uz/` answers 502 from this PC (also from the host with
curl), so the Payme sandbox page could not be shown; the production host answers 200.

## Not run on the device (blocked by the emulator failure)

Complaint with a photo, saved places / hiding recent destinations, offline banner / strip,
background ↔ foreground, the driver collecting an owed fee in cash, passes, intercity in both
apps (API only), decline with a reason, forced-update screens (API only), rider on the tablet
(landscape), driver on the phone (tab inset), and re-verification of bugs 3, 5, 7, 8, 9, 12,
14 on the devices.

## Open items

- Bug 3 on the emulator: with GMS the balanced one-shot request returned a stale fused
  position; the high-accuracy change (f263934) is untested on a device.
- Map-less mode is a fallback: production Android builds need `GOOGLE_MAPS_API_KEY` for the
  real map (or a map SDK that shows OSM tiles without Google).
- Payme sandbox 502 (external).
- The driver app's date input fields use the full keyboard (a date mask/numeric keypad would
  help); the appeal placeholder speaks about rides ("yo‘lovchi manzilni o‘zgartirdi…") even for
  a rejected application.
- **Environment**: the PC's idle sleep breaks running emulators (clock loop after resume). For
  emulator runs disable sleep (`powercfg /change standby-timeout-ac 0`) or keep a
  `SetThreadExecutionState` keep-awake running (used for the rest of this run). Both shared
  AVDs (Pixel_8, Tablet_11) need a restart; they were left running as found.

## Build notes

- `D:\tq` is short enough for CMake 3.22 (no copy needed, unlike SFF Eats' `D:\q`).
- `expo prebuild` rewrites `package.json` scripts (`expo run:android`); revert after each
  prebuild. Clean build ~7 min per app (x86_64 only).
- JDK: Android Studio `jbr`; `ANDROID_HOME` must be set for Gradle.

## Test data and cleanup

All test data was deleted from the taxi dev DB (including the pre-existing smoke-test rider,
driver and ride): users (4 non-operator), drivers, vehicles, documents, appeals, rides (10001–
10006), quotes, offers, events, ratings, ledger, tax, top-up intents, intercity trips/bookings,
notifications, outbox, SMS codes and the sessions of the run. Counts after cleanup: users 1
(operator `+998900000001`), admins 1, sessions 1 (the operator's pre-existing one), every other
transactional table 0; reference data kept (cities 11, intercity_points 12, intercity_fares 2,
settings 0 — unchanged). The SeaweedFS bucket `taxi-qa` (9 objects) was deleted. No migrations
were pending. Phone: APK uninstalled, test providers removed, `mock_location` appop back to
`default`. **Tablet: not cleaned** — its package, location and appops services answer
`Broken pipe` since the host sleep, so `uz.sff.taxi.driver` is still installed, 9 images
`/sdcard/Pictures/qa_doc_*.png` are still there, the `gps`/`network` test providers are still
registered and `com.android.shell android:mock_location` is still `allow`. A restart of the
AVD clears the test providers; then run `adb -s emulator-5556 uninstall uz.sff.taxi.driver`,
`adb -s emulator-5556 shell rm /sdcard/Pictures/qa_doc_*.png` and
`adb -s emulator-5556 shell appops set com.android.shell android:mock_location default`.
API/worker stopped by PID, Gradle/Kotlin daemons stopped, generated `android/` folders
removed, scratch folder removed.

## Screenshots (`qa/screenshots/`, downscaled)

| File                                  | Shows                                                   |
| ------------------------------------- | ------------------------------------------------------- |
| phone-r01-home-mapless.png            | map-less home instead of the crash (bug 2 fixed)        |
| phone-r02-picker-mapless.png          | map-less destination picker                             |
| phone-r03-tariffs.png                 | tariff cards with fixed prices and nearest-car ETA      |
| phone-r04-order-keyboard-before.png   | comment field at the keyboard edge (bug 7, before)      |
| phone-r05-driver-on-the-way.png       | driver on the way: distance, ETA, plate                 |
| phone-r06-cancel-fee-warning.png      | cancellation fee warning after the free waiting         |
| phone-r07-owed-fee-quote.png          | owed fee line on the next quote                         |
| phone-r08-card-awaiting-payment.png   | card ride waiting for the payment                       |
| phone-r09-no-plus-code.png            | pickup "Gulistan" without a plus code (bug 4 fixed)     |
| tablet-d01-signin-keyboard-before.png | "Kod olish" under the keyboard (bug 10, before)         |
| tablet-d02-wizard-keyboard-fixed.png  | wizard fields and footer above the keyboard (bug 10)    |
| tablet-d03-push-intro.png             | "why notifications" step after approval (bug 11 fixed)  |
| tablet-d04-offer.png                  | offer with countdown and notification                   |
| tablet-d05-waiting.png                | free waiting timer after arrival                        |
| tablet-d06-cash-to-collect.png        | done screen: cash to collect, commission, tax           |
| tablet-d07-topup-utc-time-before.png  | top-up expiry in the device's UTC zone (bug 12, before) |
