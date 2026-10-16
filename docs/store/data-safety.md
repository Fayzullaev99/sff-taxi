# Data safety (Google Play) and privacy labels (App Store)

Answers derived from what the apps actually send (apps/rider/src, apps/driver/src, the API
in apps/api). Re-check this file when a screen starts sending something new. Shared text for
the Play form: "SFF Taxi collects the data needed to order and perform rides; it is stored on
servers in Uzbekistan and never sold."

Common answers, both apps:

| Question                                    | Answer                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Does the app collect or share user data?    | Yes                                                                                               |
| Is all collected data encrypted in transit? | Yes (HTTPS/TLS only; cleartext is allowed only in debug builds pointed at a LAN API)              |
| Can users request that data be deleted?     | Yes: in the app (Profil → Akkauntni o‘chirish) or by e-mail; https://taxi.sff.uz/privacy/ §7      |
| Independent security review                 | No                                                                                                |
| Data sold to third parties                  | No                                                                                                |
| Advertising / tracking SDKs                 | None (no ads, no analytics SDK in the apps; Sentry is server-side only and without personal data) |

"Shared" below means transferred to a third party as Play defines it. Service providers acting
on our instructions (SMS gateway, push delivery, hosting in Uzbekistan) do not count as sharing;
the payment providers (Payme, Click) receive the order id and amount through their own checkout
page, which is the "payments" line.

## Rider app (uz.sff.taxi)

| Data type (Play category)                                      | Collected | Shared                                                   | Required | Purpose                                                 | Notes                                                                                             |
| -------------------------------------------------------------- | --------- | -------------------------------------------------------- | -------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Personal info → Phone number                                   | Yes       | Yes, with the assigned driver when the ride needs a call | Yes      | App functionality, account management, fraud prevention | The account id; OTP by SMS. The driver sees it only when the app shows the call button.           |
| Personal info → Name                                           | Yes       | Yes, with the assigned driver                            | No       | App functionality                                       | Optional; the driver sees the first name.                                                         |
| Personal info → Other (gender)                                 | Yes       | No                                                       | No       | App functionality                                       | Optional; only for the "Ayol haydovchi" option.                                                   |
| Personal info → Other (passenger of "for someone else" orders) | Yes       | Yes, with the assigned driver                            | No       | App functionality                                       | Name and phone of the person the ride is for; SMS to that person.                                 |
| Location → Precise location                                    | Yes       | Yes, with the assigned driver                            | No       | App functionality                                       | Pickup pin, drop-off, stops, SOS position. Foreground only; the rider can type addresses instead. |
| Financial info → Purchase history                              | Yes       | No                                                       | Yes      | App functionality                                       | Ride history with fares, payment method, receipts. No card numbers (Payme/Click checkout).        |
| Financial info → Payment info                                  | No        | —                                                        | —        | —                                                       | Card data stays with Payme/Click.                                                                 |
| Messages → Other in-app messages                               | Yes       | Yes, with the assigned driver                            | No       | App functionality                                       | Ride chat; kept 90 days after the ride.                                                           |
| Photos and videos → Photos                                     | Yes       | No                                                       | No       | App functionality                                       | Only photos the rider attaches to a complaint.                                                    |
| App activity → Other user-generated content                    | Yes       | No                                                       | No       | App functionality                                       | Ratings, complaint texts, saved places (home, work).                                              |
| App info and performance → Crash logs                          | No        | —                                                        | —        | —                                                       | No crash SDK in the app.                                                                          |
| Device or other IDs                                            | Yes       | No                                                       | Yes      | Fraud prevention, app functionality                     | A random install id made by the app (not an advertising or hardware id); the push token.          |

Permissions declared: ACCESS_FINE/COARSE_LOCATION (foreground), POST_NOTIFICATIONS, CAMERA
(complaint photos); the gallery goes through the system photo picker (no storage permission).

App Store privacy labels (rider): Data linked to you — Contact info (phone, name), Location
(precise), Purchases (purchase history), User content (photos, other), Identifiers (user id:
the install id), Usage data: none. Tracking: no.

## Driver app (uz.sff.taxi.driver)

| Data type (Play category)                                                                                     | Collected | Shared                                                                                               | Required | Purpose                                                                 | Notes                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Personal info → Name, Phone number                                                                            | Yes       | Yes, with riders (first name) and, as the law requires, with the licence registry and the tax system | Yes      | App functionality, account management, legal obligations                |                                                                                                         |
| Personal info → Other (passport data, PINFL, driving licence, licence card, vehicle documents, date of birth) | Yes       | Yes, with the licence registry / tax system as required by Resolution 200 and PP-247                 | Yes      | Legal obligations (only licensed carriers; tax agent), fraud prevention | Documents in a private store in Uzbekistan; viewed by operators only.                                   |
| Photos and videos → Photos                                                                                    | Yes       | Yes (the driver's photo and car to riders)                                                           | Yes      | App functionality, account verification                                 | Driver photo, car photo, document scans.                                                                |
| Location → Precise location                                                                                   | Yes       | Yes, with the rider of the current ride and the people they share the trip link with                 | Yes      | App functionality                                                       | Continuous while online, including in the background (foreground service on Android); off when offline. |
| Financial info → Other (balance, earnings, commission, tax withheld), Purchase history (top-ups)              | Yes       | No                                                                                                   | Yes      | App functionality, legal obligations (tax agent)                        | Top-ups through Payme/Click: no card data.                                                              |
| Messages → Other in-app messages                                                                              | Yes       | Yes, with the rider of the ride                                                                      | No       | App functionality                                                       | Ride chat.                                                                                              |
| App activity → Other user-generated content                                                                   | Yes       | No                                                                                                   | No       | App functionality                                                       | Ratings, decline/cancel reasons, trip board posts (public to riders: time, price, seats, car).          |
| Device or other IDs                                                                                           | Yes       | No                                                                                                   | Yes      | App functionality                                                       | Push token. Battery level is used on the device only (GPS interval) and not sent.                       |
| App info and performance → Crash logs                                                                         | No        | —                                                                                                    | —        | —                                                                       |                                                                                                         |

Permissions declared: ACCESS_FINE/COARSE_LOCATION, ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE
(+ _LOCATION), POST_NOTIFICATIONS, CAMERA, VIBRATE, WAKE_LOCK (keep-awake while on a ride).
Background location declaration for Play (video + text): "While the driver is online, the app
sends the position in the background so nearby ride offers reach them and the rider sees the
car approaching; the location stops when the driver goes offline." Prominent in-app disclosure
is shown before the permission request (apps/driver/src/location).

App Store privacy labels (driver): Data linked to you — Contact info, Identifiers, Location
(precise, background), Financial info (other), User content (photos, other), Sensitive info
(government id documents). Tracking: no.

## Where data goes (for the "Data handling practices" free text)

- Hosting: a data centre in Uzbekistan (Law ZRU-547 art. 27¹); encrypted backups also in Uzbekistan.
- SMS gateway (Eskiz / Play Mobile): phone numbers for sign-in codes and phone-order messages.
- Push: Expo push service → Google FCM / Apple APNs: device tokens and notification texts.
- Payments: Payme / Click: order id and amount; card data never reaches us.
- Fiscal receipts (OFD) and the tax authority; the Ministry of Transport licence registry: as
  required by Resolution 200 and PP-247, driver tax id and licence data, ride amounts.
- Error monitoring (Sentry, optional, server-side): no personal data (phones, tokens and share
  links are redacted in logs).
