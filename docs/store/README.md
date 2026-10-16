# Store listings and the launch campaign texts

Everything the founder pastes into Google Play Console and App Store Connect for the two
apps, plus the advertising copy of the launch campaign. Uzbek (Latin) is the default
listing language, Russian the second. Keep the texts in step with the apps and the prices
(`apps/api/src/lib/tariff.ts`, the launch campaign in `apps/api/src/lib/launch-campaign.ts`).

| File                             | What                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| [rider-uz.md](rider-uz.md)       | Rider app listing, Uzbek: name, short and full description, keywords, what's new      |
| [rider-ru.md](rider-ru.md)       | The same in Russian                                                                   |
| [driver-uz.md](driver-uz.md)     | Driver app listing, Uzbek                                                             |
| [driver-ru.md](driver-ru.md)     | The same in Russian                                                                   |
| [data-safety.md](data-safety.md) | Google Play Data safety form and App Store privacy labels, from what the apps collect |
| [ad-copy-uz.md](ad-copy-uz.md)   | Instagram/Telegram posts, banners, radio and outdoor lines, SMS, driver recruitment   |
| [ad-copy-ru.md](ad-copy-ru.md)   | The same in Russian                                                                   |

Placeholders to fill before publishing: the operator phone, the office address, the legal
entity (name, INN) in the privacy policy and terms (`apps/landing/.env.production`), the
landing domain if not `taxi.sff.uz`, and the reviewer phone with a fixed sign-in code
(`OTP_FIXED_CODES`, below).

## Identity

| Item                 | Rider app                                                                                      | Driver app                       |
| -------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------- |
| Name                 | SFF Taxi                                                                                       | SFF Taxi Haydovchi               |
| Play title (≤30)     | SFF Taxi: Guliston taksisi                                                                     | SFF Taxi Haydovchi               |
| App Store subtitle   | Qat’iy narx, surge yo‘q                                                                        | Haydovchilar uchun ilova         |
| Android package      | `uz.sff.taxi`                                                                                  | `uz.sff.taxi.driver`             |
| iOS bundle id        | `uz.sff.taxi`                                                                                  | `uz.sff.taxi.driver`             |
| Category (Play)      | Maps & Navigation                                                                              | Business                         |
| Category (App Store) | Travel (secondary: Navigation)                                                                 | Business (secondary: Navigation) |
| Website              | https://taxi.sff.uz                                                                            | https://taxi.sff.uz/#drivers     |
| Privacy policy URL   | https://taxi.sff.uz/privacy/                                                                   | https://taxi.sff.uz/privacy/     |
| Terms URL            | https://taxi.sff.uz/terms/                                                                     | https://taxi.sff.uz/terms/       |
| Support e-mail       | info@sff.uz (placeholder)                                                                      | info@sff.uz (placeholder)        |
| Support phone        | the operator phone (placeholder)                                                               | the operator phone               |
| Deep link scheme     | `sfftaxi://` (invite/CODE, promo/CODE, payments/{id})                                          | `sff-taxi-driver://`             |
| App links            | `https://taxi.sff.uz/invite/*`, `/promo/*`                                                     | —                                |
| Contains ads         | No                                                                                             | No                               |
| In-app purchases     | No (rides are paid to the driver or through Payme/Click for a real-world service; top-ups too) | No                               |

## Screenshot captions

Take the screenshots on a 6.7" phone (1290×2796) and a 6.1" phone, in Uzbek and Russian,
with the demo data of the QA emulator flow (`qa/`). One caption per screenshot, in order.

Rider app:

| #   | Screen                                                 | Uzbek caption                                 | Russian caption                           |
| --- | ------------------------------------------------------ | --------------------------------------------- | ----------------------------------------- |
| 1   | Home map with the pickup pin and saved places          | Qayerga boramiz? Uy va ish bir bosishda       | Куда едем? Дом и работа в одно касание    |
| 2   | Order screen with the price per class                  | Narx buyurtmadan oldin — surge yo‘q           | Цена до заказа — без наценок              |
| 3   | Driver on the way (car, plate, ETA, share/SOS buttons) | Mashina va raqami ko‘rinadi, safarni ulashing | Видно машину и номер, поделитесь поездкой |
| 4   | Payment choice: cash or card (Payme/Click)             | Naqd yoki karta — sizga qulayi                | Наличные или карта — как удобно           |
| 5   | Intercity seat board (Guliston → Tashkent)             | Toshkentga o‘rindiq — reysni tanlang          | Место до Ташкента — выберите рейс         |
| 6   | Promo codes and invitation card                        | GULISTON: birinchi safarga 50% chegirma       | GULISTON: скидка 50% на первую поездку    |
| 7   | Cargo / delivery order                                 | Yuk va yetkazib berish — taksi narxida        | Грузы и доставка — по цене такси          |
| 8   | Rating and tip after the ride, receipt                 | Baho bering, chek ilovada                     | Оцените поездку, чек в приложении         |

Driver app:

| #   | Screen                                 | Uzbek caption                               | Russian caption                            |
| --- | -------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| 1   | Online screen with an incoming offer   | Buyurtma 15 soniyada — qabul qiling         | Заказ за 15 секунд — примите               |
| 2   | Navigation hand-off and the rider card | Yo‘lovchi va manzil, navigator bir bosishda | Пассажир и адрес, навигатор в одно касание |
| 3   | Earnings: today, week, commission, tax | Daromad va komissiya — hammasi ochiq        | Заработок и комиссия — всё прозрачно       |
| 4   | Balance and top-up (Payme/Click)       | Balansni to‘ldiring, naqd sizda qoladi      | Пополните баланс, наличные остаются у вас  |
| 5   | Trip board: publish an intercity trip  | Shaharlararo reysingizni e’lon qiling       | Опубликуйте свой межгородской рейс         |
| 6   | Documents and verification status      | Hujjatlar ilovada, tekshiruv bir kunda      | Документы в приложении, проверка за день   |

## Content rating (IARC questionnaire), both apps

Violence, sexuality, profanity, drugs, gambling, horror: none. Simulated gambling: no.
User-generated content: yes, limited (ride chat between the rider and the assigned driver,
ratings, complaints; moderated by operators; no public feed). Users can interact: yes
(chat and calls with the assigned driver only). Shares location: yes (the rider's pickup to
the driver; the driver's position to the rider and share-trip page). Shares personal
information: name and phone within a ride only. Purchases: no digital goods. Result expected:
Everyone / PEGI 3 for content; **target audience 18+** ("Adults only") in Play's Target
audience section, since the terms require users to be 18.

App Store age rating: 4+ (none of the descriptors apply); "Unrestricted Web Access": no;
"Gambling": no. App Store "App uses location in background": driver app only (while online).

## App access for reviewers

Both apps sign in with an SMS code. Give the reviewers a test phone with a fixed code:
set `OTP_FIXED_CODES=+998XXXXXXXXX:123456` in production for the review period (the API
accepts it without sending SMS) and remove it afterwards (`docs/prelaunch-cleanup`). The
driver account for review must be approved by an operator beforehand with demo documents.
Explain in the review notes that rides are real-world services (no Apple IAP applies), that
background location in the driver app is for receiving nearby orders while online, and that
card payments open the Payme/Click checkout in an in-app browser.

## Release checklist

1. `eas build --profile production` for both apps (Android AAB, iOS); `eas submit`.
2. Fill the listing from the files above; upload screenshots per language; the feature
   graphic (1024×500) from `apps/landing/public/og.png` reframed.
3. Data safety form and privacy labels from [data-safety.md](data-safety.md).
4. Privacy policy and terms published on the landing site; the legal entity filled in.
5. Run the launch campaign script (docs/deploy.md "Launch campaign"), check the promo code
   in the rider app.
6. Set `STORE_URL_*` and, after both builds are live, `MIN_*_APP_VERSION` in `.env.prod`;
   fill the store links in `apps/landing/.env.production` and redeploy the site.
7. Put the Play App Signing SHA-256 into `assetlinks.json` and the Apple team id into
   `apple-app-site-association` on the landing site; test `https://taxi.sff.uz/invite/TEST123`
   on a phone with the app.
