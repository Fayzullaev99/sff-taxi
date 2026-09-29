# SFF Taxi — Competitor Feature Research v2 (pooling, women preference, intercity, cargo, UX/performance)

*Prepared: 29 September 2026. This builds on [market-analysis.md](market-analysis.md) and does not repeat its market, tariff, regulation or commission data.*
*Legend: **[V]** = verified from an official company page or help centre; **[R]** = reported by media or a secondary source; **[unverified]** = claim we could not confirm from a primary source; **[H]** = our recommendation.*

---

## 0. TL;DR

- **Shared rides:** every major player now gives the discount **upfront, whether or not a co-rider is found**, and caps the delay:
  - Uber: +8 min vs UberX.
  - Yandex: +7–10 min on average.
  - Grab: max 2 extra stops.
  - Everyone limits a booking to **1 seat** (Uber, Yandex) or 2 people (Grab).
  - Drivers are paid per rider, with a floor equal to the solo fare.
- **Women preference:**
  - The global pattern is a **preference, not a guarantee**, with gender taken from the driver's ID.
  - A strict "women-only" category (Bolt) additionally **forces rider ID + selfie verification**.
  - In Uzbekistan, Yandex has no such option. The local start-up **Ayol Taxi** (800+ women drivers, ~250 active a day) shows that demand exists.
- **Intercity:** Yandex's intercity pooling is the best template, with **max 3 co-riders (2 back + 1 front)**, the platform guaranteeing the driver's fare, and ~+15 min travel. BlaBlaCar adds "max 2 in the back" and instant booking.
- **Cargo:** Yandex uses 3 body sizes (**300 / 700 / 1,400 kg**), and the base fare includes loading/unloading minutes. The Damas and Labo sit in the "small" class.
- **Performance:**
  - Uber pushes over a persistent connection with a **4 s heartbeat** and treats **7 s of silence as a dead link**.
  - Driver apps work **optimistically offline** (about 13.5 s saved per action).
  - Uber Lite runs in **<5 MB, <300 ms per screen**, with cached landmarks and "maps on tap".

---

## 1. Shared rides / carpool (city)

### 1.1 Verified facts

| Parameter | Uber — UberX Share | Yandex Go — «Вместе» | Grab — GrabShare | DiDi — Express Pool |
|---|---|---|---|---|
| Max delay vs solo | Arrive **no more than 8 min later** than UberX [V] ([Uber newsroom](https://www.uber.com/us/en/newsroom/uberx-share/)) | **+7 min on average** [V] ([Yandex, 16.07.2026](https://yandex.ru/company/news/16-07-2026-02)); the landing page says "**on average 10 min longer**" [V] ([go.yandex carpool](https://go.yandex/ru_ru/lp/rides/carpool)) | **Max 2 stops** before your destination [V] ([Grab press](https://www.grab.com/sg/press/tech-product/share-ride-fare-grabshare-grabs-new-commercial-carpool-service/)) | not published |
| Seats per booking | **1 passenger only** [V] ([Uber help](https://help.uber.com/en/riders/article/what-is-uberx-share?nodeId=0e39e1b7-aa81-4455-a60e-310887ec6b61)) | 1 seat; "only if you are alone **and without luggage**" [V] ([go.yandex](https://go.yandex/ru_ru/lp/rides/carpool)) | Up to 2 people per booking ("bring a friend at no extra cost") [V] (Grab press) | [unverified] |
| Vehicle capacity | Max **3 riders** in the car; each rider is matched with ≤2 others [V] ([Uber driver page](https://www.uber.com/us/en/drive/services/shared-rides/)) | Max **2 passengers** at once [V] ([pro.yandex UZ](https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/rides/poputchik)) | **2 bookings** per trip [V] (Grab press) | [unverified] |
| Discount | Upfront discount; "**up to 20%**" vs UberX [V] (Uber help) | **Average saving 22%** [V] (Yandex 2026); marketing says "up to 40%" [V] (go.yandex) | "**Up to 30%**" below GrabCar Economy [V] (Grab press) | 30–50% [R] ([luke.lol blog](https://blog.luke.lol/life-pro-tips/didi-explained-expresspool-vs-express-vs-select-luxe-express-premier-taxi/)) |
| If no co-rider found | Discount is kept: savings are "applied to the upfront price… **does not require you to be matched**" [V] (Uber help) | "**Price will not go up**" if no co-rider is found [V] (go.yandex) | Fixed upfront fare [V] | — |
| Pickup wait | Driver waits **2 min** per rider, then may cancel with a fee [V] (Uber help) | [unverified] | **3 min** per passenger [V] (Grab press) | — |
| Walking to pickup | The rider may be asked to walk to a nearby corner to avoid detours [R] ([ridester](https://www.ridester.com/uberx-share/)) | Not stated | Not stated | — |
| Pick-up/drop order | "Drop off riders **in the order the app displays**"; the 2nd rider may be dropped before the 1st [V] (Uber driver page) | Driver picks up you then the co-rider, "or vice versa" [V]; the app re-routes automatically when a co-rider is found [V] (pro.yandex UZ) | Sequenced to minimise total time; "nearest drop-off to farthest" [V/R] (Grab press, [firstlane](https://www.firstlane.com.sg/what-is-grabhitch-vs-grabshare/)) | — |
| Driver pay | Base fare + **extra fare for each pickup after the first**; total ≥ the equivalent UberX trip; waiting for the 2nd rider is paid per minute [V] (Uber driver page) | **Each co-rider = 1 order**, and each pays separately. The driver gets **≥ the tariff minimum fare**; if no co-rider is found, the shortfall is paid as a bonus [V] (pro.yandex UZ) | — | — |
| Driver UI | Request is labelled UberX Share; navigation updates when a rider is added [V] | Order labels «**Первый попутчик**» / «**Сразу два попутчика**»; the first passenger gets a numbered map marker [V] (pro.yandex UZ) | — | — |
| Scale | — | 76 Russian cities; **up to 10% of all rides** in some cities; tens of millions of trips in 2025 [V] (Yandex 2026) | — | — |
| UZ availability | No | Driver KB page exists for **Tashkent** [V] (pro.yandex UZ). Rider-side availability outside Tashkent: [unverified] | No | No |

**Matching logic disclosed:**
- **Grab** weighs trip angle, ETA, detour and efficiency. In its demand analysis it treated bookings **<300 m apart** as neighbours [V] ([Grab engineering](https://engineering.grab.com/the-data-and-science-behind-grabshare-part-i)).
- **Yandex** uses demand density, seasonality and typical routes [V] (Yandex 2026).

### 1.2 UX patterns observed
- Pooling is a **separate tariff card** in the class carousel ("Вместе", "UberX Share"), not a toggle hidden in options. The card shows the discounted price upfront [V] (all sources above).
- A **seat-count selector is absent** in city pooling (always 1 seat). Seat count appears only in intercity (see §3).
- The rider is warned **before ordering** that there can be a co-rider and that the trip is longer [V] ([Yandex](https://yandex.ru/company/news/16-07-2026-02)).
- Showing the co-rider's name or photo to the other rider: not documented by any player [unverified]. Yandex shows the driver "first/two co-riders"; the rider side only sees that a co-rider exists.

---

## 2. Women-only / female-driver preference

### 2.1 Verified facts

| Player | What it is | Who can use / verification | Guarantee | Markets |
|---|---|---|---|---|
| **Uber — Women Preferences** | Rider: choose "Women drivers" on request or reservation, or set a standing preference. Driver: toggle "**Women Rider Preference**" on/off at any time [V] ([FAQ](https://help.uber.com/en/riders/article/women-preferences-faq?nodeId=b1846e08-48f4-440c-8938-0dd6fb27d699), [driver help](https://help.uber.com/en/driving-and-delivering/article/women-rider-preferences?nodeId=646d88d9-0194-46bb-8030-f9f45de757ad)) | Only riders and drivers whose gender is "Woman" in the app. **Drivers: gender from government ID. Riders: gender inferred from first name** [V] ([CNBC](https://www.cnbc.com/2025/07/23/uber-women-drivers-riders.html), FAQ). Male riders are unaffected [V] | **Not guaranteed**; longer waits possible; the rider can switch to a faster ride [V] ([Uber newsroom](https://www.uber.com/us/en/newsroom/expanding-women-preferences/)) | Originated in **Saudi Arabia 2019**; ~40 countries; US pilot in LA/SF/Detroit (Aug 2025) → +26 cities (Nov 2025) → nationwide US [R] ([NBC](https://www.nbcnews.com/news/us-news/ubers-women-only-option-goes-nationwide-us-rcna262636)). **Teen accounts** can request women drivers [V] |
| **Bolt — "Women for Women"** | A separate ride category shown after the destination is entered [R] ([expats.cz](https://www.expats.cz/czech-news/article/bolt-launches-women-only-ride-option-in-czechia-to-boost-safety-and-inclusivity)) | **Mandatory rider verification: ID upload + selfie**, matched against name, DOB and photo [R] ([dev.ua](https://dev.ua/en/news/bolt-women-for-women), [ITWeb](https://www.itweb.co.za/article/bolt-tightens-rider-verification-as-sa-safety-tools-remain-underused/lwrKxq3Y2OE7mg1o)). Drivers are verified women | Strict category: only women are matched | South Africa (8 cities), Kyiv, Helsinki, Czechia, Brussels, France [R]. Women-driver availability **+66%** in 6 months; France **+95%** women drivers [R] ([search summary of Bolt releases](https://www.citizen.co.za/business/bolt-expands-women-only-rides-amid-ekurhuleni-women-killings/)). Women were ~3% of active Bolt drivers in Ukraine (2024) [R] |
| **inDrive** | Driver setting "**Only female passenger**"; passengers can choose female drivers (South Africa) [R] ([inDrive LinkedIn](https://www.linkedin.com/pulse/women-move-us-our-female-drivers-success-stories-pakistan-indrive), [ITWeb](https://www.itweb.co.za/article/indrive-accelerates-focus-on-female-drivers/rW1xL75nZbKMRk6m)) | Driver chooses passengers under the bid model | Not a guarantee | PK, ZA; not in UZ (left in 2023) |
| **Careem** | Female "Captainah" drivers; the female-driver option is **restricted to female riders or families** (KSA 2018) [R] ([Arab News](https://www.arabnews.com/node/1303491/saudi-arabia), [Argaam](https://www.argaam.com/en/article/articledetail/id/549069)) | Female-only call centre in Jeddah; female training centre with female coaches [R] | — | KSA; Dubai "Ameera" women-only chauffeur [R]. Pakistan: female bike captains with **guaranteed monthly pay** (Rs30k part-time / Rs50k full-time) [R] ([Dawn](https://www.dawn.com/news/1741077)) |
| **Yandex Go** | No official "woman driver" filter found. A blog claims one exists, but it cites no source [unverified] ([logists.by](https://logists.by/blog/mozhno-li-v-yandeks-taksi-vyzvat-zhenschinu)) | — | — | Nothing in UZ [R] |
| **Ayol Taxi (UZ)** | Uzbek app + Telegram bot with **women drivers only**; "Family" tariff to ride with family members [R] ([spot.uz 01.03.2024](https://www.spot.uz/oz/2024/03/01/ayol-taxi/)) | Drivers need **≥2 years' experience** | — | Fergana → Tashkent (Samarkand planned). **800+ registered / ~250 active women drivers daily, 500+ orders/day, 23k users**. **Min fare 13,000 so'm, 2,300 so'm/km** (≈2.7× Yandex Guliston's 850/km cap), 3–5% cashback [R] |

### 2.2 Abuse prevention and privacy observed
- **Uber:** gender comes from government ID for drivers but only from the first name for riders. That is a weak rider check, and there is no public mismatch-reporting process [V].
- **Bolt:** a strict category needs strict verification, so it uses ID + selfie. Bolt also forces verification on riders flagged by its **Safety Score** and on **all new users within their first month** (South Africa) [R] (ITWeb).
- Privacy: none of these players shows the rider's gender or ID to the driver; only the matching engine uses it [unverified].
- **Supply:** only **4,107 of 481,100 (0.85%)** self-employed taxi drivers in UZ are women (see market-analysis §0). Ayol Taxi's **~250 active women a day** across Fergana and Tashkent shows that a dedicated product can recruit them [R].

---

## 3. Intercity / between-district rides

| Player | Model | Seats vs whole car | Pricing | Scheduling / meeting | Source |
|---|---|---|---|---|---|
| **Yandex Go UZ «Межгород»** (May 2026) | Driver publishes offers; the rider picks one | Whole car **or 1+ seats**; the driver chooses the format | **Driver sets the price** | Driver posts several days ahead; the user books **≤2 days** ahead; after booking the rider **contacts the driver** to agree time and stops. Insurance plus speed and driving-style monitoring | [V] [spot.uz](https://www.spot.uz/ru/2026/05/06/yandex-go/) |
| **Yandex Go RU intercity pooling** (Mar 2024) | Algorithmic co-rider matching inside the intercity tariff | **Max 3 co-riders: 2 back + 1 front**. One rider can book several seats (= 1 order); a group must board and alight at the same point | Rider saves **up to 30%**. Travel **+~15 min**. **10 min stop included free**. The platform **pays the driver in full even if no co-rider is found**. Fare is recalculated (can go down) if co-riders are not matched; each co-rider pays separately; cash is collected by the driver | Book **3 h – 3 days** ahead. The driver sees pre-orders in the widget with the full route, all stops and the number of matched co-riders. The navigation prompt appears **90–45 min** before start. Driver "Обратно" (return) mode finds return pre-orders | [R] [vc.ru](https://vc.ru/transport/1098715-yandeks-go-dobavil-vozmozhnost-razdelit-mezhdugorodnyuyu-poezdku-na-taksi-i-ee-stoimost-s-poputchikami); [V] [pro.yandex KZ poputchik-intercity](https://pro.yandex.com/kz-ru/semey/knowledge-base/taxi/rides/poputchik-intercity), [pro.yandex pre-order](https://pro.yandex.ru/ru-ru/moskva/knowledge-base/taxi/tariffs/pre-order-tariff-intercity) |
| **Yandex Pro "seat-publish" mode** | The driver publishes one trip with a **price per seat**; passengers book seats and get **private contacts and a boarding code**. Price is **fixed after the first booking**; commission is charged once for the seats carried | Seats | Per seat | Actions: publish, edit, book, cancel, board, dispute | [R] (search summary; primary page not fetched) |
| **inDrive City-to-City** | Rider posts an order with a **proposed price**, date and time; drivers counter on price or time; offers arrive within ~1 min; the rider calls the driver to agree details | Sedan 3–4, SUV 5–6; minibus on request | Bid | "Timetable-free". Safety: ratings, mandatory background checks, safety button | [V] [intercity.indrive.com](https://intercity.indrive.com/en), [inDrive IN](https://intercity.indrive.com/en/in) |
| **BlaBlaCar** | Private drivers post trips; **instant booking or manual approval** (driver chooses) | Per seat; driver option "**Max. 2 in the back seats**" | Platform suggests a price from distance + fuel + wear (historically €0.048/km/seat, €0.065 with tolls [R]). **Passenger-only service fee**, ≈16–20% of price [R] | Money held until the ride | [R] [BlaBlaCar blog](https://blog.blablacar.in/blablalife/whats-new/max-2-in-back-seats), [ridester](https://www.ridester.com/blablacar/) |
| **Uber Intercity (India)** | Whole car, door-to-door, stops allowed; **one-way or Round Trip up to 5 days** with the same car and driver | Whole car | Upfront | **Reserve up to 90 days ahead**; 3,000+ routes (Jul 2025) | [V] [Uber newsroom](https://www.uber.com/in/en/newsroom/uber-intercity-expands-to-3000-routes-across-india/), [Uber reserve](https://www.uber.com/in/en/ride/how-it-works/reserve/); [R] [newsbytes](https://www.newsbytesapp.com/news/auto/uber-launches-round-trip-feature-for-intercity-rides/story) |
| **GrabHitch** (social carpool) | Everyday commuters | **Up to 4 seats per request** | **Flat price by distance, never surged**; 20–40% cheaper | Book **up to 7 days** ahead | [R] [Grab Hitch](https://www.grab.com/sg/hitch-flat-price/), [Yahoo](https://sg.finance.yahoo.com/news/grabhitch-does-160000675.html) |

**Takeaways:**
- **Seat layout (2 back + 1 front)**, **front-seat premium** (UZ market practice, see market-analysis §3) and a **boarding code** are standard.
- The platform should guarantee the driver's payout when seats are unfilled; Yandex does this in its intercity pooling.

---

## 4. Cargo and delivery as extra services

| Service | Facts | Source |
|---|---|---|
| **Yandex Go «Грузовой» (UZ)** | 3 body sizes. **Small** ≥170×100×90 cm, **300 kg** (Berlingo/Largus class; Labo and Damas are named for UZ). **Medium** ≥260×130×150 cm, **700 kg** (Transit, H100). **Large** ≥380×180×180 cm, **1,400 kg** (GAZ-3302, Sprinter). Optional **loader** (the driver loads, unloads and carries to the floor); refusing the loader service once it is ordered is forbidden. **No people in the cargo bay**; no construction waste, safes or pianos | [V] [pro.yandex Tashkent cargo](https://pro.yandex.com/uz-ru/tashkent/knowledge-base/delivery/delivery-cargo/cargo), [delivery.yandex.uz](https://delivery.yandex.uz/cargo/taxi/) |
| Launch pricing | **Tashkent (Nov 2020): from 63,000 so'm**, including **10 min loading + 10 min unloading + first 40 min + 15 km**. Vehicles: Gazel-3302, ISUZU, **Daewoo Labo**, Changan, Lifan [R] ([spot.uz](https://www.spot.uz/ru/2020/11/26/yandex-go/)). **Fergana (Oct 2021): from 58,000**, including 10+10 min load/unload, 20 min and 10 km; fleet includes **Chevrolet Damas**. **One seat for the cargo owner**; per-item weight ≤30 kg (without loader) [R] ([spot.uz](https://www.spot.uz/ru/2021/10/27/fergana/)) | [R] |
| Current pricing | Dynamic, by size, distance, loaders and traffic; the site says **Tashkent only** [V] (delivery.yandex.uz) | [V] |
| **Yandex «Доставка» (courier)** | Express parcels in Tashkent in ~1 h; dynamic price by weight, distance and traffic [R] ([delivery.yandex.uz](https://delivery.yandex.uz/ru/)) | [R] |
| **MyTaxi (UZ)** | Tariffs include **Delivery**, **Cargo (3 body sizes)**, **Suburban** (out-of-town), **Inclusive** (disability), **Transfer** (drive your car) and "**Accumulator**" (jump-start a flat battery) [R] ([Google Play listing](https://play.google.com/store/apps/details?id=com.uznewmax.mytaxi&hl=en)) | [R] |
| **inDrive Courier / Freight** | Same bid model. **≤20 kg → courier** (moto/car); **>20 kg → freight** (trucks). Offers within ~2 min [R] ([cargo.indrive](https://cargo.indrive.com/freight-delivery), [indrive delivery](https://indrive.com/delivery)) | [R] |
| **Uber Connect / Courier** | Car-boot parcels: **≤20 kg and ≤US$100 value** (small tier ≤5 kg / $20), sealed, curbside hand-over [R] ([gridwise](https://gridwise.io/blog/uber-connect-driver/the-ultimate-guide-to-uber-connect-ubers-package-delivery-service/), [Uber help](https://help.uber.com/driving-and-delivering/article/uber-connect---package-delivery-faq?nodeId=34d104e2-3ce3-444f-b5dc-cbcad889337d)) | [R] |
| **WB Taxi** | Up to **2 simultaneous orders**; order for another person (SMS with car details); "Multi" class search; in-app calling was still under development [R] ([Google Play](https://play.google.com/store/apps/details?id=uz.wildberries.taxi.client&hl=en_US)) | [R] |
| Informal market (Tashkent 2026) | Gazel **200,000 so'm per 2 h + 80,000/h**; 3 t 300,000/2 h; 5 t Isuzu 400,000/2 h [R] ([166.uz](https://166.uz/uz/yuk-tashish-narxlari)) | [R] |

**Regulatory note:**
- Resolution 200 **forbids van-type cars (Damas) as passenger taxis** (market-analysis §4).
- Cargo carriage by Damas/Labo falls under a separate freight regime [unverified — confirm with a lawyer]. Keep cargo a separate service with no passenger seats sold; one accompanying owner is allowed, as in Yandex Fergana.

---

## 5. UX and performance patterns

### 5.1 Ordering in 1–2 taps
- **Uber (Feb 2023 redesign):** tapping "Where to?" shows Saved Places plus **personalised destination and ride-type suggestions** from past trips [V] ([Uber newsroom](https://www.uber.com/us/en/newsroom/were-redesigning-the-uber-app-just-for-you/), [TechCrunch](https://techcrunch.com/2023/02/22/uber-redesigns-app-for-simpler-more-personalized-experience/)). An iOS home-screen widget orders a ride "**in as little as two taps**" [R] ([9to5mac](https://9to5mac.com/2024/11/20/uber-ios-widget/)).
- **Yandex Go (Apr 2026):** AI predicts the destination from day, time and frequency, and **active users chose suggested addresses 15% more often**. It offers **ready-made pickup comments** ("arch with black gates", "entrance #3"), shows a **countdown until a driver is assigned**, and recommends tariffs and options from the rider's comments [R] ([iXBT](https://www.ixbt.com/news/2026/04/23/jandeks-go-teper-predlagaet-podskazat-kuda-podehat-voditelju.html), [4pda](https://4pda.to/2026/04/23/455658/yandeks_go_teper_umeet_predskazyvat_dejstviya_polzovatelya/)).
- **Yandex Go (Sep 2025):** a **street panorama of the pickup point** with a yellow pin [V] ([Yandex news](https://yandex.ru/company/news/19-09-2025-01)).
- **Layout:** full-screen map with a bottom sheet (address → class carousel with price + ETA per card → one big order button). This is a common pattern across Uber, Yandex and Bolt [R] (observed in the redesign articles above; no single spec source).

### 5.2 Pickup precision
- **Uber suggested pickup spots** favour two-way streets and corners, learned from past trips [R] ([Digital Trends](https://www.digitaltrends.com/phones/uber-testing-feature-that-suggests-best-pickup-spots-for-speedier-trips/), [Uber help](https://help.uber.com/riders/article/what-are-suggested-pickup-locations?nodeId=9edf05bf-ac3a-4cf8-b08e-76e9ca767f7f)). Map "**access points**" define preferred pickup and drop-off for an address [V] ([Uber maps metrics blog](https://www.uber.com/us/en/blog/maps-metrics-computation/)).
- **GPS error in built-up areas can be 50 m or more**. Uber fuses GNSS with Android Fused Location, using SNR "shadow matching" against 3D maps and a **particle filter** (not a Kalman filter, because the error is non-Gaussian) [V] ([Uber blog](https://www.uber.com/us/en/blog/rethinking-gps/)).
- **Uber Lite:** when GPS or network fails, it **guides the rider to pick a nearby landmark** (POIs replace typed addresses) [V] ([Uber Lite engineering](https://www.uber.com/us/en/blog/engineering-uber-lite/)).

### 5.3 Real-time location and car-marker smoothing
- **Uber real-time push (RAMEN):** push instead of polling, because polling had been **80% of API gateway requests**. The server sends a **1-byte heartbeat every 4 s**, and the client treats **7 s without a message as a broken connection**. Acks go every 30 s, and message TTL ranges from seconds to 30 min [V] ([Uber blog](https://www.uber.com/us/en/blog/real-time-push-platform/)).
- **Driver GPS ping every 4 s** is widely cited for Uber [R] (secondary system-design articles; no primary Uber page found → [unverified] as an exact figure).
- **Adaptive ping rates attributed to Grab:** 15–30 s idle, 4–5 s en route to pickup, 2–3 s on trip [unverified] ([dev.to article](https://dev.to/vesviet/system-design-gps-location-ingestion-at-scale-grpc-streaming-mqtt-kalman-filter-in-3pm), not a Grab source).
- **Android guidance:**
  - Use HIGH_ACCURACY only for **foreground real-time** use, and "reserve intervals of a few seconds for foreground use cases".
  - Batch with `maxUpdateDelay` set to several times the interval.
  - Background location is throttled to a "few times an hour" on Android 8+.
  - Source: [V] ([Android developers](https://developer.android.com/develop/sensors-and-location/location/battery)).
  - → The driver app must run a **foreground service**.
- **Marker animation:** interpolate linearly between consecutive fixes with a ValueAnimator and rotate by bearing (turf `rhumbBearing`). This is standard practice; Uber's exact method is not published [R] ([GeeksforGeeks](https://www.geeksforgeeks.org/how-to-add-uber-car-animation-in-android-app/), [ActiveBridge](https://activebridge.medium.com/how-to-build-uber-car-animation-using-mapbox-markers-ecdeb5261df1)).

### 5.4 Offline and poor network
- **Uber driver "Optimistic Mode":** the driver can **end a trip offline**. Optimistic requests and transforms are persisted to disk and survive restarts; dependent requests are queued with timeouts. **~13.5 s saved per optimistic operation** [V] ([Uber blog](https://www.uber.com/us/en/blog/driver-app-optimistic-mode/)).
- **Uber Lite:**
  - Size and speed: **<5 MB download, <25 MB on device**, **<300 ms screen-to-screen**.
  - Network: payload **<1 MTU**, **one request per screen**, a single TCP connection on 2G, and state-change-only updates.
  - Caching: destinations cached on Wi-Fi/full battery; product and payment profiles cached.
  - Map: "**maps on tap**" (optional map).
  - Target: 2015-era devices; 33% of rides were on sub-3G networks.
  - Source: [V] ([Uber blog](https://www.uber.com/us/en/blog/engineering-uber-lite/), [Android Authority](https://www.androidauthority.com/uber-lite-india-launch-875795/)).

### 5.5 Driver destination filters

| Player | Rule | Source |
|---|---|---|
| Yandex Pro «Домой» | **Max 2 times a day**; orders toward the saved home address; not from airports; remaining uses visible in the bottom sheet | [V] [pro.yandex](https://pro.yandex.ru/ru-ru/samara/knowledge-base/taxi/app/homeward) |
| Yandex Pro «По делам» | Toward any chosen address; limit **varies by city**; may mean detours to pickup | [V] same |
| Yandex Pro «Мой район» | Pickup **and** drop-off inside a radius set with a slider; **extra % commission**; no bonuses or income guarantee; not counted to goals | [V] same |
| Yandex Pro «Обратно» (intercity) | Auto-matches return pre-orders | [V] [pro.yandex](https://pro.yandex.ru/ru-ru/moskva/knowledge-base/taxi/tariffs/pre-order-tariff-intercity) |
| Uber Destination Filter | **2 uses a day**; a use counts only when a trip is received; unlimited trips toward that destination; resets at midnight; extra tokens for Pro Gold+ after long trips to low-demand areas | [R] [Rideshare Guy](https://therideshareguy.com/how-does-ubers-destination-filter-work/), [Uber help](https://help.uber.com/en/driving-and-delivering/article/driver-destinations-on-uber?nodeId=2ed197fc-ec16-4f35-9ca0-cacb4ff3ce7a) |

### 5.6 In-app safety

| Feature | Facts | Source |
|---|---|---|
| PIN to start ride | Uber "Verify Your Ride": **4-digit PIN**; the trip cannot start until the driver enters it; rider opts for **every ride or only at night (21:00–06:00)** | [V] [Uber help](https://help.uber.com/riders/article/whats-verify-my-ride/?nodeId=2ddbb5e8-0dd3-4048-b9ee-f6b5e5311e25), [Uber blog](https://www.uber.com/pl/en/blog/pin-number/) |
| Pickup code | Bolt "one-time pick-up code" | [R] [ITWeb](https://www.itweb.co.za/article/bolt-tightens-rider-verification-as-sa-safety-tools-remain-underused/lwrKxq3Y2OE7mg1o) |
| Audio recording | Uber: starts as the driver nears pickup, ends **20 s after the trip**. **AES-GCM encrypted on the device, kept 7 days**; nobody can play it, and Uber gets it only if the user attaches it to a safety report. Bolt: rider or driver starts it; attach to a support case | [V] [Uber](https://www.uber.com/us/en/ride/safety/audio-recording/), [R] [BusinessDay](https://businessday.ng/technology/article/bolt-targets-safety-with-audio-trip-recording-feature/) |
| Anomaly detection | Uber RideCheck: long unexpected stops, possible crashes (accelerometer/gyro) and route deviation → push to rider and driver "Are you OK?" with SOS, safety line, report crash, change destination, share trip; ML filters false positives | [V] [Uber newsroom](https://www.uber.com/us/en/newsroom/ridecheck/) |
| Yandex Go (RU) | Live trip sharing to relatives; **route deviation / unusually long trip → support calls both parties**; GPS speed vs the limit, with warnings and then order restrictions; **encrypted rider phone number**; 112 from the app; crash detection; accident insurance 2M ₽ | [V] [go.yandex safety](https://go.yandex/ru_ru/lp/safety/passengers) |
| Trusted contacts | Bolt: share live trip with **up to 3 trusted contacts**; contacts can be reached by the safety team in an emergency | [R] [ITWeb](https://www.itweb.co.za/article/bolt-adds-trusted-contacts-to-in-app-safety-toolkit/PmxVE7KEJGGqQY85) |
| Adoption reality | Bolt South Africa: only **1 in 5 trips is shared**; SOS/audio used in **~1 in 200 trips**, although 96% of respondents say safety tools make rides safer | [R] [ITWeb](https://www.itweb.co.za/article/bolt-tightens-rider-verification-as-sa-safety-tools-remain-underused/lwrKxq3Y2OE7mg1o) |

---

## 6. Recommendations for SFF Taxi (Sirdaryo-adapted)

Context from market-analysis:
- Guliston is ~105k people, and typical city trips are 2–7 km.
- Towns are 6–55 km apart; Guliston–Tashkent is ~120 km.
- 63% of trips are paid in cash; 84% of users are on Android, mostly low-end.
- Women are ~0.85% of drivers.
- Our fixed-price, no-surge brand promise.

### 6.1 Priorities

| Pri | Feature | Why |
|---|---|---|
| **P0** | Inter-town / intercity **per-seat pooling** (auto-match + driver "trip board") with a boarding code | Biggest real demand (Telegram/avtovokzal market); Yandex UZ is driver-priced only |
| **P0** | 1–2-tap home screen, landmark-based pickup, offline-tolerant driver app, foreground location service | Low-end Android and patchy rural coverage |
| **P0** | Safety basics: share trip, SOS, masked numbers, route-deviation alert, **4-digit PIN (default on at night)** | Cheap to build; regulator and brand trust |
| **P1** | City pooling «Birga» in Guliston (peak hours only) | Useful at peaks (students/GulDU, bazaar, vokzal); low density off-peak |
| **P1** | Driver destination filter «Uyga» (home) + «Qaytish» (return leg for intercity) | Most drivers live in the districts and commute to Guliston |
| **P1** | Cargo «Yuk» (Damas/Labo small, Porter/Gazel medium) + parcel «Pochta» on intercity seats | Bazaar and agricultural economy; empty boots on Tashkent runs |
| **P2** | Women preference «Ayol haydovchi» + driver "women riders only" | Brand signal; supply too thin for a strict category at launch |
| **P2** | Encrypted in-app audio recording | Low usage elsewhere (~1/200 trips); legal review needed |

### 6.2 City pooling «Birga» — numeric defaults [H]
- **Availability:** Guliston city polygon only. Enable at hours where ≥N open requests exist per 10 min (start: 07:00–10:00, 12:00–14:00, 17:00–20:00). Hide the card when the match probability is <30%.
- **Seats:** **1 seat per booking**; max **2 riders** in the car (Yandex model — a 4-seat Cobalt/Nexia with luggage limits); "no large luggage" warning.
- **Detour cap:**
  - Each rider arrives **≤5 min later** than solo, and total detour is **≤40% of the solo trip time** (whichever is smaller).
  - Max **1 extra stop** per rider.
  - Pickup-to-pickup distance ≤1.2 km; route bearing difference ≤45°.
  - Uber allows 8 min, but our trips are short (5–15 min), so 5 min is proportionally similar.
- **Walking:** optionally suggest a pickup ≤150 m away (street corner/landmark). Never mandatory.
- **Price:**
  - Upfront **−20%** vs the Start band price, **guaranteed even if unmatched**. Uber and Yandex both do this; Yandex's actual average is 22%.
  - Round to 500 so'm.
  - Minimum pooled fare **4,000 so'm**.
  - No extra "matched bonus" at launch (simplicity).
- **Driver pay:**
  - Each rider is a separate order with a separate cash payment and fiscal receipt. This is legal under Res. 200 cl. 19 (fare split proportional to distance).
  - **Driver floor = the solo band price of the longer leg + 2,000 so'm.** SFF tops up any shortfall from the platform fee, as Yandex does with its bonus.
- **Waiting:** **2 min** free per rider in pooling (vs 3 min solo). After that the driver may mark a no-show, and a fee applies to that rider only.
- **Order:** the dispatcher computes the optimal pickup/drop sequence. The driver UI shows numbered markers "1", "2" with labels "1-yo'lovchi" / "Ikkala yo'lovchi" and **must follow the app order** (Uber rule).
- **Rider UI:**
  - A separate class card "Birga −20%" with a one-line note: "Yo'lda yana 1 yo'lovchi bo'lishi mumkin, +5 daqiqagacha".
  - After matching, show "Hamrohingiz: 1" with no name or photo (privacy).
  - A **woman rider may tick "faqat ayol hamroh"** (female co-rider only); that narrows the pool.

### 6.3 Intercity per-seat «Shaharlararo» — numeric defaults [H]
- **Seat layout:** 4 seats = **1 front + 3 back**. Driver option "**orqada max 2**" (BlaBlaCar-style comfort) → then 3 seats.
- **Booking:** one booking can hold 1–4 seats (a group boards and alights together). Book **15 min – 3 days** ahead; operators can book for phone callers.
- **Pricing:** fixed SFF seat price per route (not driver-set as in Yandex UZ; this keeps the fixed-price promise). The driver may adjust **±15%** (as in market-analysis §6.4).
  - Front seat **+10%**. A **women-only back row** is allowed (see §6.5).
  - **Whole car = 4 × seat price −10%.**
- **Detour for door-to-door pickups:**
  - **≤12 min total detour per trip inside the origin town**, max **3 pickups + 3 drop-offs**.
  - Alternatively, a **fixed meeting point** at no surcharge: Guliston avtovokzal, railway station, the Tashkent Olmazor stand and district bazaars.
  - **Door pickup costs +5,000 so'm** when it adds >5 min.
  - One **10 min comfort stop** is free on trips >90 min (Yandex RU rule).
- **Departure rule:**
  - Scheduled departure time is shown up front. If a car is <2 seats full **60 min before departure**, SFF offers the riders a merged car or a whole-car upgrade at no extra cost to them.
  - **Driver guarantee:** the driver receives at least **3 seats' fare** once ≥2 seats are sold and the driver departs on time (Yandex pays the driver in full when co-riders are not found). Budget: this subsidy is capped at 10% of intercity GMV.
- **Boarding:** **4-digit boarding code** per booking; the driver swipes "Yetib keldim" (I've arrived) → code → "Ketdik" (let's go). Each drop-off closes that booking and issues its fiscal receipt.
- **Driver pre-order widget:** route with all stops, seats sold, and a navigation prompt **60 min** before pickup; **«Qaytish»** mode suggests return pre-orders from the destination.
- **Cancellation:** rider free ≥2 h before departure; after that 20% of the seat price (to the driver). If the driver cancels <2 h before departure: priority penalty + SFF re-books the riders.
- **Parcels on intercity** («Pochta»): ≤10 kg, sealed, sender and recipient phones verified by OTP at hand-over; price 30% of a seat [H]. Uber Connect's ≤20 kg / value cap is the reference.

### 6.4 Cargo «Yuk» — defaults [H]
- **Classes (Yandex dimensions):**
  - **Kichik** (Damas/Labo, ≥170×100×90 cm, ≤300 kg in-app; Labo physically carries more).
  - **O'rta** (Porter/Gazel, ≥260×130×150, ≤700 kg).
  - **Katta** (Isuzu 3–5 t) only as a P2 pre-order.
- **Loader option:** +1 or +2 loaders, per-person fixed fee.
- **One accompanying seat for the owner**; nobody in the cargo bay.
- **Price (Guliston, P1 starting point, to validate in the field):**
  - Kichik **35,000 so'm** including 10+10 min load/unload + 20 min + 10 km. Anchor: Yandex Fergana 2021 = 58,000 incl. 10 km/20 min, and Guliston car fares are ~20% below Tashkent.
  - Then **1,500 so'm/km + 300 so'm/min**; O'rta ×1.6.
  - Inter-town cargo per km uses the zone matrix ×1.3.
- **Legal:** onboard cargo drivers under a separate profile (no passenger taxi licence implied; Damas cannot be a passenger taxi); verify the freight licence rules [unverified].

### 6.5 Women preference «Ayol haydovchi» — rules [H]
- **Phase 1 (P2, launch):**
  - A **driver-side toggle "Faqat ayol yo'lovchilar"** (women riders only), available to drivers whose gender comes from **passport/ID at onboarding** (Uber rule). This costs little and helps recruit women drivers (Bolt: +66–95% women drivers after launch).
  - A **rider-side preference** "Ayol haydovchini afzal ko'raman" (I prefer a woman driver), shown only when ≥1 verified woman driver is online within **5 km**.
  - It is **not a guarantee**: after **90 s** without a match, offer "any driver" or keep waiting.
  - Never add a price premium. Ayol Taxi charges 2,300 so'm/km; we stay on standard prices.
- **Phase 2:** a strict «Ayollar uchun» category once there are **≥15 active women drivers in Guliston at peak**.
  - **Rider verification required:** passport/ID photo + selfie liveness (Bolt model).
  - First-name inference (Uber) is too weak for Uzbek names used by both genders and for accounts shared within families.
- **Family rule (Careem):** a verified woman may book for herself plus **children and family members**. The booking holder must be in the car, and the driver may refuse and report if the booking holder is absent.
- **Abuse prevention:**
  - Report "yo'lovchi mos kelmadi" (rider doesn't match) → the order is closed with no fee for the driver.
  - **2 reports → preference access removed**, with human review.
- **Privacy:**
  - Gender and ID are used only by matching and never shown.
  - ID images are stored in UZ (Art. 27-1), encrypted, and deleted **30 days after verification**, keeping only the verified flag.
- **Supply programme:** a women-driver onboarding day and a female support line (Careem practice); a **guaranteed hourly minimum** for women drivers in peak hours during the first 3 months (Careem PK precedent).
- **Pool/intercity:** the "faqat ayol hamroh" (female co-rider only) filter and a **women-only back row** on intercity. Both are verified the same way as Phase 2.

### 6.6 Home screen and ordering UX — defaults [H]
- **Home screen = map + bottom sheet:**
  - "Qayerga?" (Where to?) field.
  - Below it, **3 chips**: Uy (Home), Ish (Work) and the top predicted destination (by weekday and hour).
  - Below those, **2 recent trips**.
  - Tapping a chip goes straight to the price screen with the class preselected → **2 taps to order**.
- **Class carousel:** each card shows **fixed price (bold) + pickup ETA**, in order Start, Birga, Komfort, Shaharlararo, Yuk. The order button repeats the price ("Buyurtma — 7 000 so'm").
- **Pickup:**
  - The pin **snaps to the road-side point** of the nearest OSM road or entrance within **30 m**.
  - A **landmark picker** (bazaar, vokzal, GulDU, hospital, school no.) is used when GPS accuracy is >50 m or there is no GPS.
  - **Ready-made driver comments** ("darvoza oldida" (at the gate), "do'kon yonida" (by the shop), "bekatda" (at the stop)) instead of typing (Yandex 2026).
- **Search while offline:** cache the top 300 regional POIs + the user's last 20 addresses on the device (Uber Lite).
- **Performance budget (rider app):**
  - Cold start **<2.5 s** on a 2 GB-RAM Android; **<300 ms** screen-to-screen (Uber Lite).
  - **One API call per screen**; order-flow responses **<5 KB**; map tiles optional ("xaritani ko'rsatish" (show map) toggle).

### 6.7 Location, realtime and poor network — defaults [H]

| Driver state | GPS interval | Priority | Upload |
|---|---|---|---|
| Offline | none | — | — |
| Online, idle | **15 s** (or 50 m moved) | BALANCED | batch every 15–30 s |
| Accepted → to pickup | **4 s** | HIGH_ACCURACY | every fix |
| On trip | **3 s** | HIGH_ACCURACY | every fix; batch when the link is down |
| Battery <15% | ×2 intervals | BALANCED | — |

- **Transport:** a persistent WebSocket with a **4 s heartbeat and a 7 s dead-link timeout** (RAMEN numbers). Reconnect with exponential backoff (1 → 2 → 4 → max 30 s). Fall back to HTTP polling every 10 s.
- **Rider car marker:**
  - Interpolate between fixes over the interval length (linear, 60 fps, easing off), rotating by bearing.
  - **Map-match to the route polyline** when the fix is within 25 m.
  - Drop fixes with accuracy >50 m or an implied speed >150 km/h.
  - Extrapolate ≤2 intervals along the route if updates stop, then show "aloqa kutilmoqda" (waiting for connection).
- **Driver app optimistic actions:** "Yetib keldim" (I've arrived), "Ketdik" (let's go), "Yakunlash" (finish) and cash confirmation work offline. They are persisted to disk and synced idempotently with client timestamps and IDs; the fare is computed locally from the fixed tariff (Uber Optimistic Mode).
- **Server-side:** reject ride completion if the GPS trace is missing >50% while the device reports online (fraud flag), rather than blocking the driver.

### 6.8 Driver destination filter — defaults [H]
- «**Uyga**» (home): **2 uses a day**. A use is counted only when an order is accepted (Uber rule). Match orders whose drop-off brings the driver **≥50% closer to home**, with pickup ≤3 km off the direct line. Allowed from the vokzal/avtovokzal (no airport in the region).
- «**Qaytish**» (intercity return): unlimited; auto-offers return seats from the destination's trip board.
- «**Tumanim**» (my district): stay within a chosen district radius at **no extra commission** (unlike Yandex's paid "Мой район"). This is a differentiator for rural drivers.

### 6.9 Safety — defaults [H]
- **PIN:** 4 digits, **default ON 21:00–06:00** and for all women-preference and intercity trips; optional for other trips. Intercity reuses the boarding code.
- **Share trip:** one tap from the trip screen; auto-share to up to **3 trusted contacts** (Bolt) for night trips if the rider enables it.
- **Anomaly alerts** (RideCheck/Yandex):
  - A stop **>5 min** outside a traffic jam, or a route deviation **>1 km** from the planned route → push "Hammasi joyidami?" (Is everything OK?) to rider and driver.
  - No answer in 2 min → operator call.
- **Speed alerts:** >20 km/h over the limit for 30 s → driver warning; 3 in a week → review.
- **Masked calls** through a virtual number (SIP) and in-app chat. The rider's number is hidden from the driver after the trip ends.
- **Audio recording (P2):** device-side, AES-GCM, **7-day retention**, uploaded only when attached to a complaint (Uber model). A legal check on UZ consent rules is needed [unverified].
- Expect low usage (Bolt: 1/5 shares, 1/200 SOS). Automate protections (PIN at night, auto-share) rather than relying on riders to opt in.

### 6.10 What NOT to copy
- **Driver-set intercity prices** (Yandex UZ): they break the fixed-price promise. Use the ±15% band only.
- **Bid pricing for cargo/courier** (inDrive): too slow for phone orders. Use fixed prices by class.
- **Surge for pooling or intercity on holidays:** use a flat, pre-announced holiday add-on (market-analysis §6.3).
- **Strict women-only category before supply exists:** it creates "no car found" failures, which is WB Taxi's main complaint.

---

## 7. Open questions [unverified]
1. Is Yandex «Вместе» live for riders anywhere in UZ outside Tashkent, including Guliston? Check the app in Guliston.
2. Is Ayol Taxi still operating in 2026, and does it serve Sirdaryo? What is the actual number of women drivers in Sirdaryo region (ask the regional transport department)?
3. What is the legal basis for Damas/Labo cargo-on-demand via an aggregator (licence type, insurance)?
4. Is in-car audio recording by a platform permitted under UZ personal-data law (consent, localisation)?
5. What is the exact Uber/Grab driver GPS ping interval? Only secondary sources were found. Our defaults are set independently and should be tuned by field battery tests on 3 low-end devices.
