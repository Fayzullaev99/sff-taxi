# SFF Taxi — Market & Product Analysis (Guliston / Sirdaryo region)

*Prepared: 26 September 2026. Research-only document for the SFF Taxi engineering and product team.*
*Currency: so'm (UZS). CBU rate on 26.09.2026: 1 USD = 11,825.40 so'm ([kursiv.media](https://uz.kursiv.media/2026-09-25/kurs-dollara-26-sentyabrya/)).*
*Legend: **[V]** = verified from a primary/official source; **[R]** = reported by media/secondary source; **[U]** = unverified / needs field check; **[C]** = our own calculation from cited inputs; **[H]** = hypothesis / recommendation.*

---

## Rahbar uchun qisqacha xulosa (Executive summary, o'zbekcha)

1. Guliston (104,6 ming aholi) va Sirdaryo viloyati (946,3 ming aholi, 1.01.2026) — kichik, lekin to'liq bo'sh bo'lmagan bozor: Yandex Go 2024-yil 28-avgustdan beri Gulistonda ishlaydi.
2. Yandex Gulistonda "Start" tarifi: chaqiruv ≤4 000 so'm (1 km + 3 daqiqa kiradi), shahar ichida ≤850 so'm/km va ≤190 so'm/daq, shahar tashqarisida ≤2 200 so'm/km; komissiya 11% (QQS bilan). "Komfort": 4 800 so'm, 1 050 so'm/km, komissiya 12%.
3. Yandex Go O'zbekistonda agregatorlar bozorining 86,3% ini egallagan (Raqobat qo'mitasi, 2023) va narx dinamikasi uchun ogohlantirish olgan — "adolatli, oldindan ma'lum narx" bizning asosiy xabarimiz bo'lishi kerak.
4. inDrive 2023-yil 31-iyulda O'zbekistondagi faoliyatini to'xtatgan; qaytgani haqida ma'lumot topilmadi. Demak, Gulistonda "savdolashuv" modelidagi raqobatchi yo'q.
5. WB Taxi (Wildberries) — Toshkent (2025-dekabr), Samarqand (2026-iyun), Buxoro (2026-iyul); 50% keshbek "tarvuz"larda va "pasaytirilgan komissiya" bilan kirmoqda. Gulistonda hali yo'q.
6. Bozor naqd pulga tayangan: 2026-yil yanvar–avgustda legal taksi aylanmasining 63,1% i naqd. Naqd-birinchi yondashuv shart.
7. Avtoparki: Cobalt 27%, Nexia 19,3%, Lacetti 16,1%; metan narxi 5 700–5 800 so'm/m³ (2026-iyun) — haydovchi xarajatining asosiy qismi.
8. Qonun: haydovchi o'zini o'zi band qilgan shaxs + litsenziya kartochkasi; agregator soliq (fiskal chek) va Transport vazirligi tizimlariga integratsiya qilinishi va faqat litsenziyali haydovchilar bilan ishlashi shart (VM qarori №200, 02.04.2025). Litsenziyasiz haydovchi uchun agregator subsidiar javobgar.
9. Soliq: 2026-yildan o'zini o'zi band qilgan taksichilar uchun 1% aylanma solig'i; agregator soliq agenti sifatida ushlab qoladi.
10. Tavsiya — narx: shahar ichida masofa bo'yicha qat'iy (fiks) narx bantlari, surge yo'q; tuman/shaharlararo — km bo'yicha qat'iy narx va "o'rindiq bo'yicha" (poputka) variant.
11. Tavsiya — haydovchi uchun: dastlabki 3 oy 0% komissiya, keyin 5% (kuniga maksimal 10 000 so'm cheklov bilan) yoki kunlik/haftalik obuna. Yandexning 11% idan ancha past.
12. Tavsiya — taqsimot: eng yaqin haydovchiga avtomatik taklif (15 soniya), rad etsa keyingisiga; 2 martadan so'ng radius bo'yicha "efir". Shaharlararo reyslarda haydovchi o'zi narx/vaqt e'lon qiladi.
13. Smartfonsiz mijozlar uchun telefon orqali buyurtma (dispetcher paneli) P0 bo'lishi kerak — kichik shaharlarda bu raqobat ustunligi.
14. SFF Eats kuryerlari bilan umumiy haydovchi bazasi — bo'sh vaqtda yetkazib berish, bu haydovchi daromadini oshiradi.
15. Asosiy xavflar: litsenziya hududi cheklovi (Toshkent shahriga qatnov), soliq/fiskal integratsiya muddati, Yandex/WB reaksiyasi (bonus urushlari), xavfsizlik hodisalari.
16. P0 (ishga tushirish): yo'lovchi ilovasi (naqd/karta, fiks narx), haydovchi ilovasi (litsenziya tekshiruvi, 1% soliq, fiskal chek), dispetcher paneli (telefon buyurtma), shaharlararo "o'rindiq" rejimi, SOS va "safarni ulashish".
17. Birinchi qadam: 1 hafta dala tadqiqoti — Guliston avtovokzali va bozorlarida real narxlarni (shahar ichi, Yangiyer, Toshkent o'rindig'i) yozib olish; bu hujjatdagi [U]/[H] raqamlarni tasdiqlash.

---

## 0. Key numbers at a glance

| Metric | Value | Source |
|---|---|---|
| Sirdaryo region population (1 Jan 2026) | 946.3k (43.0% urban / 57.0% rural) | [V] [Sirdaryo stat. dept. press release 27.01.2026](https://sirstat.uz/images/2025/deckbrdemog1.pdf) |
| Guliston city population (1 Jan 2026) | 104.6k | [V] same |
| Yandex Go in Guliston since | 28 Aug 2024 (14th UZ city) | [R] [gazeta.uz](https://www.gazeta.uz/oz/2024/08/28/guliston/), [spot.uz](https://www.spot.uz/oz/2024/08/28/yandex-go-gulistan/) |
| Yandex Guliston "Start" max tariff | 4,000 pickup (1 km+3 min incl.), 850/km, 190/min, 2,200/km out-of-city, 500/min waiting; commission 11% incl. VAT (from 22.10.2025) | [V] [pro.yandex Guliston](https://pro.yandex.com/uz-ru/gulistan/knowledge-base/taxi/news/tariffs-changes), [taxi.yandex.uz/gulistan](https://taxi.yandex.uz/ru_uz/gulistan/tariff/) |
| Yandex share of aggregator market (Dec 2023) | 86.3% | [R] [gazeta.uz](https://www.gazeta.uz/ru/2023/12/08/yandex/) |
| Legal taxi market, Jan–Aug 2026 | 329.04M trips; 7.2 trn so'm; avg fare 21,785.5 so'm; cash 63.1% | [R] [gazeta.uz 04.09.2026](https://www.gazeta.uz/ru/2026/09/04/taxi/) |
| Self-employed taxi drivers (national) | 481,100 (of which 4,107 women) | [R] same |
| Aggregators integrated with tax system | 242 (vs 155 end-2024) | [R] same |
| Taxi fleet by model | Cobalt 27%, Nexia 19.3%, Lacetti 16.1%, EV 2.5% | [R] same |
| Methane (CNG) retail price | 5,700–5,800 so'm/m³ from 1 Jun 2026 | [R] [spot.uz](https://www.spot.uz/ru/2026/06/01/cng-up/) |
| Internet penetration (end 2025) | 89.0%; Android 83.8% of mobile web traffic | [R] [DataReportal 2026](https://datareportal.com/reports/digital-2026-uzbekistan) |
| Self-employed turnover tax (from 1 Jan 2026) | 1% (turnover ≤1 bn so'm/yr), withheld by aggregator | [V] [pro.yandex taxes](https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/partners/taxes-yandex-pro) |

---

## 1. Yandex Go (Taxi) in Uzbekistan

### 1.1 Footprint
- Operating in UZ since 2018; Uzcard/Humo/Visa/Mastercard card payment launched in Tashkent in March 2021 [R] ([gazeta.uz 2021](https://www.gazeta.uz/ru/2021/03/23/yandex-go/), [anons.uz](https://anons.uz/ru/news/yandexgo-zapustil-oplatu-kartoy)).
- Regional expansion 2024: Guliston (28.08.2024, 14th city), Jizzakh (Sept 2024), Navoi (Dec 2024) [R] ([spot.uz Jizzakh](https://www.spot.uz/oz/2024/09/27/yandex-go-jizzax/), [spot.uz Navoi](https://www.spot.uz/oz/2024/12/03/yandex-go-navoi/)).
- **Guliston:** served. Tariffs available in Guliston: **Start, Comfort (launched 12 Mar 2025), "По Узбекистану" (intercity)** [V] ([pro.yandex Guliston news list](https://pro.yandex.com/uz-ru/gulistan/knowledge-base/taxi/news), [taxi.yandex.uz/gulistan](https://taxi.yandex.uz/ru_uz/gulistan/tariff/)). Yandex Eats/Delivery courier knowledge base also exists for Guliston ([pro.yandex courier news](https://pro.yandex.com/uz-ru/gulistan/knowledge-base/courier/news)).
- **Yangiyer, Shirin, Sirdaryo, Baxt, district centres:** no separate Yandex city pages found [U]. Trips from Guliston to these towns are priced with the "out-of-city" per-km rate (2,200 so'm/km max in Start).
- Launch-day price example Guliston: railway station → Musical Drama Theatre ≈ 4,500 so'm; minimum 4,000 so'm; cash and card [R] ([spot.uz](https://www.spot.uz/oz/2024/08/28/yandex-go-gulistan/)).

### 1.2 Tariff classes (UZ)
Listed across UZ: Start, Standard (cancelled in Tashkent 5 Dec 2023 — [spot.uz](https://www.spot.uz/ru/2023/12/07/yandex-tariffs/)), Comfort, Comfort+, Electro, Business, Premier, "Вместе" (shared), Fasten, Delivery, Cargo ("Грузовой", Tashkent since 2020), Intercity ("Межгород", since 6 May 2026) [V/R] ([auto-list](https://pro.yandex.com/uz-uz/tashkent/knowledge-base/taxi/tariffs/auto-list), [tariff page](https://taxi.yandex.uz/ru_uz/tashkent/tariff/), [spot.uz cargo](https://www.spot.uz/ru/2020/11/26/yandex-go/), [spot.uz intercity](https://www.spot.uz/ru/2026/05/06/yandex-go/)).

### 1.3 Pricing model — Guliston vs Tashkent (max tariffs from 22 Oct 2025) [V]

| Parameter | Guliston Start | Guliston Comfort | Tashkent Start |
|---|---|---|---|
| Pickup (incl. 1 km + 3 min + 2 min waiting) | ≤4,000 | ≤4,800 | ≤4,600 |
| In-city per km | ≤850 | ≤1,050 | ≤1,050 (voyage.uz, Mar 2026 [R]) |
| Per minute | ≤190 | ≤230 | ≤500 [R] |
| Out-of-city per km | ≤2,200 | ≤2,650 | 2,500 |
| Paid waiting | 500/min | 600/min | 650/min in city |
| Free waiting | 2 min | 2 min | 2 min |
| Pet option | 2,900 | — | 3,700 |
| Commission to Yandex (incl. VAT) | **11%** | **12%** | **16.5%** (Start) / 18.5% (higher classes) |

Sources: [Guliston changes](https://pro.yandex.com/uz-ru/gulistan/knowledge-base/taxi/news/tariffs-changes), [Guliston tariff page](https://taxi.yandex.uz/ru_uz/gulistan/tariff/), [Tashkent changes](https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/news/tariffs-changes), [Tashkent tariff page](https://taxi.yandex.uz/ru_uz/tashkent/tariff/), [voyage.uz](https://voyage.uz/guides/transport-yandex-go/).

- **Surge ("повышенный спрос"):** the tariff page states prices are "maximum" and coefficients apply for peak hours and demand density [V] ([tariff page](https://taxi.yandex.uz/ru_uz/tashkent/tariff/)). Actual fares are dynamic.
- **Cancellation:** paid if the passenger cancels after the car is dispatched or does not show up; charged as minimum fare plus excess waiting [V] (same page).
- **Commission history:** 13% → 14.6% in Dec 2023 when Yandex Go became a UZ tax resident [R] ([kun.uz](https://kun.uz/en/news/2023/12/06/yandex-go-increases-the-commission-collected-from-drivers-due-to-payment-of-taxes)); now 11–18.5% by city/class [V].
- **Worked examples, Guliston Start, before any coefficient [C]:**
  - 2 km / 6 min: 4,000 + 1×850 + 3×190 = **5,420**
  - 4 km / 10 min: 4,000 + 3×850 + 7×190 = **7,880**
  - 7 km / 15 min: 4,000 + 6×850 + 12×190 = **11,380**
  - Guliston → Yangiyer, whole car (≈30 km, 35 min; 3 km in city): 4,000 + 2×850 + 27×2,200 + 32×190 ≈ **71,000**
  - Comfort 4 km / 10 min: 4,800 + 3×1,050 + 7×230 = **9,560**

### 1.4 Payments
Cash; bank cards Uzcard, Humo, Visa, Mastercard (tips by card possible) [R] ([gazeta.uz 2021](https://www.gazeta.uz/ru/2021/03/23/yandex-go/)). Guliston: cash and card at launch [R]. Electronic fiscal receipts for every ride, including cash rides, since Dec 2023 / Feb 2024 [R] ([spot.uz](https://www.spot.uz/ru/2024/02/21/fiscalization/)). Yandex Pay / Plus cashback in UZ: [U].

### 1.5 Driver side
- **Legal model:** driver must be self-employed with a licence card and assign a partner park ("taxopark") as commissioner. Legal basis is PP-4742 of 08.06.2020 [V] ([pro.yandex licence](https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/partners/license-for-partners)). Onboarding: form → Yandex Pro → document check → licence + licence card → online ([taxi.yandex.uz/driver](https://taxi.yandex.uz/driver/ru-uz/)).
- **Park economics in Guliston:** OLX ads from Yandex partner parks in Guliston advertise "Komissiya 0%", "1.4% komissiya, Bonus 300 000 so'm" and "Yandex BLOK ochamiz" (we unblock accounts) [R] ([OLX Guliston, Sept 2026](https://www.olx.uz/oz/gulistan/q-taksi/)). Parks compete on their own fee on top of Yandex's 11%. Account blocks are a real pain point for drivers.
- **Taxes:** Yandex withholds the 1% turnover tax per order as tax agent (PP-247 of 12.08.2025). Above 1 bn so'm/yr the driver pays 15% profit tax + 12% VAT himself [V] ([pro.yandex taxes](https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/partners/taxes-yandex-pro)).
- **Car requirements:** 4+ doors. Model/age by tariff via a classifier; details are given by the park [V] ([auto-list](https://pro.yandex.com/uz-uz/tashkent/knowledge-base/taxi/tariffs/auto-list)). Premium classes require profile photo standards ([photo-how-to](https://pro.yandex.com/uz-uz/tashkent/knowledge-base/taxi/tariffs-premium/photo-how-to)).
- **Dispatch / priority:** In UZ, "Priority for accepted orders" replaced "Activity". Score 0–100. It rises for completed orders and falls for skips, and falls more for cancellations of accepted orders. At 0 the driver gets no orders. It does not reset daily [V] ([priority](https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/app/priority-instead-of-activity)). With several suitable cars, a higher-priority car may get the order even if slightly farther ([priority Andijan](https://pro.yandex.com/uz-ru/andizhan/knowledge-base/taxi/income-diff/priority)).
- **Order chains ("цепочки")**: documented in Yandex Pro knowledge base (RU) [R] ([chain](https://pro.yandex.ru/ru-ru/moskva/knowledge-base/taxi/app/chain)). UZ availability of chains, "home" destination filter and paid "смены": [U].
- **Loyalty programme (from 1 Mar 2026):** 5 levels (Master, Profi, Ekspert, Chempion, Legenda). The lower levels give non-cash perks such as Plus and priority. The top level gives ≈50% commission discount on Start in Tashkent. Chempion needs 12 and Legenda 36 consecutive months of activity [R] ([spot.uz](https://www.spot.uz/oz/2026/02/25/yandex/)).
- **Driver income claim:** average ≈10.2M so'm/month for fleets and drivers (assumes 8 h/day, 22 days); fleets and drivers earned 6.6 trn so'm in Jan–Nov 2025 [R] ([uzdaily](https://www.uzdaily.uz/en/income-of-yandex-go-partner-fleets-and-their-drivers-in-uzbekistan-exceeds-66-trillion-soums-in-2025/)).
- Driver Telegram bot launched Apr 2026 ([news list](https://pro.yandex.com/uz-ru/gulistan/knowledge-base/taxi/news)).

### 1.6 Safety (policy disclosed July 2026) [R] ([gazeta.uz](https://www.gazeta.uz/ru/2026/07/06/yandex-taxi/))
- Checks on documents and vehicles, and regular selfie photo-control. AI is used to detect fraud.
- Route risk scoring: complex routes go to experienced drivers rather than the nearest one.
- In-trip speed and manoeuvre monitoring, plus crash detection with smartphone sensors.
- Safety centre: share the trip, contact support, call emergency services. Masked phone numbers and route-deviation or unplanned-stop detection.
- A driver "Conflict" button records the front camera straight to support.
- Passenger insurance up to 100M so'm during the trip. Serious incidents are reviewed by humans.

### 1.7 Rider features
Confirmed in UZ: upfront price, ETA/driver info, card/cash, tips, pet option, accessibility options (wheelchair, text-only communication, hearing), share trip, business accounts ([business.go.yandex](https://business.go.yandex/ru_uz)), social taxi for children with disabilities ([go.yandex social](https://go.yandex/ru_uz/lp/rides/social)), intercity with per-seat booking and pre-booking up to 2 days ahead ([spot.uz](https://www.spot.uz/ru/2026/05/06/yandex-go/)).
Generic Yandex Go features whose **UZ availability we did not verify [U]**: multi-stop, scheduled rides in city, child-seat option (documented for KZ: [pro.yandex KZ](https://pro.yandex.com/kz-ru/almaty/knowledge-base/taxi/common/children)), split payment, Plus cashback, promo codes.

### 1.8 Intercity ("Межгород", since 6 May 2026) [R] ([spot.uz](https://www.spot.uz/ru/2026/05/06/yandex-go/))
- 23 routes of 50–340 km at launch, focused on Tashkent. Ride a whole car or buy 1+ seats.
- **The driver sets the price**, and the passenger picks an offer. Drivers can post trips several days ahead; users book up to 2 days ahead. Insurance and speed monitoring apply.
- This is a marketplace-style (driver-offer) model, not metered.

### 1.9 Known complaints and regulatory pressure
- Competition Committee found Yandex Go dominant (86.3%) in Dec 2023 [R] ([gazeta.uz](https://www.gazeta.uz/ru/2023/12/08/yandex/)). It warned Yandex to lower prices and revise the pricing algorithm after detecting sharp price dynamics [R] ([podrobno.uz](https://podrobno.uz/cat/obchestvo/komitet-po-konkurentsii-predupredil-yandex-go-o-neobkhodimosti-snizheniya-tsen-/)). Antitrust compliance is mandatory for dominant platforms (Yandex Go, Yandex Eats, Express24) [R] ([vc.ru](https://vc.ru/offline/1615480-komitet-po-razvitiyu-konkurencii-uzbekistana-priznal-monopolistami-yandex-go-yandex-eats-i-express24)).
- Wrongful charges refunded after consumer complaints (Tashkent, Kashkadarya) [R] ([kun.uz](https://kun.uz/en/news/2025/05/23/yandex-go-returns-wrongfully-charged-funds-to-users-in-uzbekistan)).
- Driver discontent over commission and fuel costs. The boycott call for 15 Dec 2025 largely failed [R] ([kun.uz](https://kun.uz/21275206), [vaqt.uz](https://vaqt.uz/uz/news/yandexga-boykot-taksi-haydovchilari-nimadan-norozi-15518)).
- Licence-territory rule (from 2 Apr 2025) threatened ~23,000 Tashkent drivers; 27% of Yandex drivers in Tashkent were registered in other regions (May 2025) [R] ([spot.uz](https://www.spot.uz/oz/2025/06/13/taxi-restrictions/)).

---

## 2. "WB Taxi" (Wildberries & Russ)

- **What it is:** the ride-hailing brand of Wildberries & Russ (RWB). It registered the "WB Taxi" trademark [R] ([bfm.ru](https://www.bfm.ru/news/612684)). RWB acquired Citymobil, Taxovichkof and Gruzovichkof [R] ([click-or-die](https://click-or-die.ru/2026/05/kogda-v-rossii-zapustyat-wb-taxi-vot-chto-izvestno-ob-agregatore-taksi-kotoryj-uzhe-rabotaet-v-belorussii-i-uzbekistane/)).
- **It does operate in Uzbekistan:**
  - Closed beta in Tashkent from mid-Dec 2025 ([kursiv.uz](https://uz.kursiv.media/uz/2025-12-16/wildberries-ozbekistonda-wb-taxi-ilovasini-ishga-tushirdi/)).
  - Open to all from 23 Mar 2026 ([spot.uz](https://www.spot.uz/ru/2026/03/23/wb-taxi/)).
  - Samarkand from June 2026 ([spot.uz](https://www.spot.uz/oz/2026/06/24/wb-taxi-skd)) and Bukhara from 13 Jul 2026 ([gazeta.uz](https://www.gazeta.uz/ru/2026/07/13/wb-taxi/)).
  - Also in Minsk and Bishkek. **Not in Guliston/Sirdaryo** as of Sept 2026 [R].
- **Rider proposition:**
  - Classes: Standard, Comfort, Comfort+.
  - "Multi" searches several classes at once.
  - **50% cashback in "watermelons" (1 = 1 so'm)**, usable for up to 99% of later rides, only with card payment in the app [R] ([spot.uz](https://www.spot.uz/ru/2026/03/23/wb-taxi/)).
  - A 1.5 km Comfort+ ride was reported at about half local competitors' price in Tashkent. Service was limited to designated zones early on [R] ([iguides](https://www.iguides.ru/main/other/kak_rabotaet_wb_taxi_v_dva_raza_deshevle_konkurentov_i_keshbek_50/)).
- **Driver proposition in UZ:** "transparent terms, reduced aggregator commission, fast payouts, guaranteed shift income if targets are met". **Exact % is not published** [R] ([gazeta.uz](https://www.gazeta.uz/ru/2026/07/13/wb-taxi/)).
  - In Russia it was reported as 7%, with 0% for 6 months for early joiners [R] ([click-or-die](https://click-or-die.ru/2026/05/kogda-v-rossii-zapustyat-wb-taxi-vot-chto-izvestno-ob-agregatore-taksi-kotoryj-uzhe-rabotaet-v-belorussii-i-uzbekistane/)).
  - A Minsk driver report claims an effective ~19% [R] ([myfin.by](https://myfin.by/article/avto/za-den-podnimau-650-rublej-voditeli-wb-taxi-rasskazali-skolko-polucaut-na-samom-dele-46904)).
  - The model also bundles parcel delivery with rides [R].
- **Problems:** ~20 consumer complaints Jan–Aug 2026 (cars not arriving, drivers unreachable, operator inaction). The Competition Committee sent an inquiry and found consumer-protection and e-commerce violations (Sept 2026) [R] ([spot.uz](https://www.spot.uz/oz/2026/09/15/wb-taxi), [gazeta.uz](https://www.gazeta.uz/oz/2026/09/15/wb-taxi-uzb/)).
- **Takeaways for SFF:**
  - A low commission plus a guaranteed shift minimum wins drivers.
  - Cashback subsidies buy riders but are expensive.
  - Supply reliability (no-shows) is the Achilles' heel of a new entrant. Build acceptance, timeouts and no-show handling from day one.

---

## 3. Other players

| Player | Status in UZ | Guliston/Sirdaryo | Model / commission | Notes |
|---|---|---|---|---|
| **inDrive** | **Stopped passenger service in UZ on 31 Jul 2023** [R] ([spot.uz](https://www.spot.uz/oz/2023/07/31/indrive-stop/), [spot.uz ru](https://www.spot.uz/ru/2023/07/31/indrive-stop/)). No evidence of a return found (Sept 2026) [U] | Not operating [R] | Bid pricing (passenger proposes, drivers counter). Service fee ≈10% (KZ) [R] ([astanahub](https://astanahub.com/en/blog/indrive-zapuskaet-tarif-s-fiksirovannoi-stoimostiu-poezdki)); also launched a fixed-price tariff in KZ (Jul 2025) | Popular in CIS because of low commission and a sense of price control. Its own move to a fixed tariff shows bidding friction. Earlier UZ attempts: 2016, 2018, 2021 |
| **MyTaxi** (UZ, since 2015) | Tashkent-centred; registration points in Tashkent and Termez [V] ([company.mytaxi.uz](https://company.mytaxi.uz/)) | Not confirmed [U] | Classes Economy (from 24,000/ride), Comfort (26,000), Premium (45,000), Delivery. Car not older than 2005. Only basic Uzbek required for Economy [V] ([drivers plans](https://drivers.mytaxi.uz/ru/plans)). Commission not published [U] | Driver compensation when the passenger cancels after arrival; payouts to card ([drivers.mytaxi.uz](https://drivers.mytaxi.uz/ru)) |
| **Uklon** | In UZ since Jun 2023; 15M+ trips in 2025; ~90 staff; Fergana-valley expansion (5 cities) with driver onboarding from 5 Aug 2026 [V] ([uklon.com.ua](https://uklon.com.ua/en/news/uklon-expands-into-the-fergana-valley-launching-in-five-new-cities-across-uzbekistan/)) | No [R] | Classes Light / Comfort / "Fast search". Reduced commission in new cities until year-end [R]. Bonus-based loyalty programme ([terms](https://uz.uklon.eu/en/legal/uklon-driver-loyalty-programme-terms/)) | Drivers must be 21+ with 1+ year of experience |
| **Yango** | Yandex's international brand; in UZ the brand is Yandex Go | — | — | Not a separate competitor in UZ [U] |
| **Maxim (Taxsee)** | Present in UZ (Tashkent; office in Andijan) [R] ([taximaxim Andijan](https://taximaxim.com/uz/en/14605-andijon/contacts/)) | Not confirmed [U] | Phone + app, regional focus | Known for cheap small-city operation in RU/KZ |
| **WB Taxi** | See §2 | No | Low commission + 50% rider cashback | Tashkent, Samarkand, Bukhara |
| **Millennium Taxi, "UzTaxi", Alliance, Taksi-Lyuks** | Tashkent phone-dispatch brands mentioned in directories [R] ([top.uz](https://top.uz/section/zakaz-taksi/sirdarya)) | top.uz lists **0** taxi-ordering companies in Sirdaryo [R] | Phone dispatch | Shows there is no organised local dispatch brand with an online presence |
| **Local apps** (Online Taxi, BizningTaxi short number 1177, Gold Taksi) | Play Store listings; "Online Taxi" reportedly lists Guliston [U] | [U] | Fixed prices, cash/card | Could not verify activity or volumes — field check |
| **Telegram groups** ("Guliston Toshkent taksi" etc.) | Active; one group has ~2,418 members [R] ([t.me](https://t.me/s/gulistontoshkenttaksi)) | Yes — mainly Guliston↔Tashkent | Negotiated per seat, phone contact | This is the informal intercity market SFF must digitise |
| **Intercity per-seat operators** (GO TOSHKENT, Yo'ldaTaxi, TaksiTop) | Apps/sites for per-seat intercity | GO TOSHKENT: **Shirin→Tashkent 90,000 so'm/seat** (rear), Bekobod→Tashkent 80,000, front seat +10,000 [R] ([gotoshkent.uz](https://site.gotoshkent.uz/?lang=en)); date not stated [U] | Fixed per-seat fare, 24/7 operator | Direct precedent for the SFF "o'rindiq" product |

**Informal "shashka" / phone-dispatch taxis:** in practice drivers wait at bazaars, the avtovokzal and the railway station and take cash. Resolution 200 (2025) now requires even non-aggregator taxis to have a licence, TAXI roof sign and a taximeter app with electronic payment ([lex.uz](https://www.lex.uz/uz/docs/-7459068)). So informal supply is under pressure to join a legal platform. **That is an opening for SFF**, because the platform provides the legally required taximeter/fiscal function.

**Intercity shared taxis (Guliston ↔ Tashkent):**
- Distance ≈120 km [R] ([Wikipedia](https://en.wikipedia.org/wiki/Guliston)).
- In Tashkent, cars for the Sirdaryo/Guliston direction gather near Olmazor (Almazar) [R] ([tashtrans.uz](https://tashtrans.uz/mezhdugorodnee-taksi-tashkenta/)).
- Rail alternative: Guliston trains use Tashkent-Janubiy station (since Oct 2023) [R] ([daryo.uz](https://daryo.uz/2023/10/12/toshkent-markaziy-vokzali-16-oktyabrdan-oz-faoliyatini-avvalgi-jadval-boyicha-boshlaydi)).
- **Current Guliston–Tashkent per-seat price: not found in any online source [U].** Anchor: Shirin–Tashkent is 90k/seat. Guliston is closer to Tashkent than Shirin, so its seat price should be lower. Measure it in the field.
- Holiday spikes are typical: inter-regional seat prices rose 20–100% before New Year 2022 [R] ([gazeta.uz](https://www.gazeta.uz/oz/2021/12/24/ticket/)).

---

## 4. Regulation (Uzbekistan) — what the platform must implement

| Topic | Rule | Source |
|---|---|---|
| Who may drive | Self-employed person or legal entity **with a licence card** for passenger transport. Taxi is on the self-employed activity list (PP-4742, 08.06.2020) | [V] [lex.uz PP-4742](https://lex.uz/docs/4849605?ONDATE=01.01.2024), [pro.yandex](https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/partners/license-for-partners) |
| Licence fee / term | Reported 300,000 so'm state fee, 1-year licence, 10% discount via my.gov.uz. PP-311 (07.07.2022) sets an annual fee of one base calculation amount — **verify the current amount** | [R] search summaries of [xabar.uz](https://www.xabar.uz/uz/avtomobil/taksi-qilishni-xohlaganlar-licenziya), [oldmy.gov.uz](https://oldmy.gov.uz/ru/news/1027); [V] [lex.uz PP-311](https://lex.uz/ru/docs/6100009) |
| Driver requirements | Age 21+, category B, medical exam, 3+ years' experience, UZ citizenship (Res. 200, cl. 10) | [V] [lex.uz Res. 200](https://lex.uz/ru/docs/7459068) |
| Vehicle | ≤4 passenger seats + driver; city use ≤15 years old; carrier liability insurance mandatory; **taximeter-function app with electronic payment mandatory**; **van-type (Damas) prohibited** as taxi; "TAXI" roof sign + black squares on doors (Appendix 2) | [V] same (as summarised from the lex.uz text) |
| Licence territory | Work within the licence region **and adjacent regions** (cl. 14). In force since 2 Apr 2025; the Ministry of Transport confirmed the restriction | [V] same; [R] [spot.uz](https://www.spot.uz/oz/2025/06/13/taxi-restrictions/) |
| Shared rides | Clause 19: fare may be split among passengers **in proportion to each passenger's distance** — legal basis for per-seat / shared rides | [V] [lex.uz Res. 200](https://lex.uz/ru/docs/7459068) |
| Intercity | Self-employed may do city, suburban **and intercity** passenger transport (Appendix 3) | [V] same |
| Aggregator obligations | Serve **only licensed carriers** in their territory; **integrate with tax systems for electronic fiscal receipts**; integrate with Ministry of Transport / National Agency of Perspective Projects systems; **joint (subsidiary) liability** for unlicensed carriers (cl. 2, 7). Earlier rules also required tax residency and integration with the "Uztrans" system | [V] same; [R] [podrobno.uz](https://podrobno.uz/cat/obchestvo/v-uzbekistane-kardinalno-uprostili-rabotu-taksi-glavnoe-iz-postanovleniya-mirziyeeva-/) |
| Fiscal receipts | Every ride (cash too) gets an electronic fiscal receipt via the aggregator's tax integration. Yandex since Dec 2023; MyTaxi and Uklon also integrated | [R] [spot.uz](https://www.spot.uz/ru/2024/02/21/fiscalization/) |
| Driver tax | 1% turnover tax (≤1 bn so'm/yr), **aggregator withholds and remits by the 15th of the next month** (PP-247, 12.08.2025). Drivers on integrated aggregators are exempt from the new QR-payment requirement | [V] [pro.yandex](https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/partners/taxes-yandex-pro); [R] [spot.uz](https://www.spot.uz/oz/2026/01/02/taxi-taxation) |
| EV incentive | From 1 Mar 2026: up to 30% discount on social tax for self-employed EV taxi drivers | [R] [spot.uz](https://www.spot.uz/oz/2026/01/24/ev-taxi) |
| Carrier insurance | Compulsory carrier civil-liability insurance. Sum reported as equivalent to 44M so'm per passenger; policy term 3–12 months for car carriers | [R] summary of [lex.uz law](https://www.lex.uz/acts/2652781), [CM Res. 266](https://lex.uz/docs/2752507?ONDATE=05.04.2022) — verify the current sum |
| Personal data | Art. 27-1 of the Law on Personal Data (in force 15 Apr 2021): store UZ citizens' personal data on servers physically in UZ, registered in the state register. Amended Jan 2026 to allow some categories abroad under conditions | [R] [LoC](https://www.loc.gov/item/global-legal-monitor/2021-05-07/uzbekistan-new-requirements-for-uzbek-citizens-personal-data-localization-enter-into-force/), [gazeta.uz 2026](https://www.gazeta.uz/en/2026/01/21/data/) |
| Consumer protection | The Competition Committee actively enforces against aggregators (Yandex, WB Taxi); a Cabinet regulation of 1 May 2024 is cited | [R] [spot.uz](https://www.spot.uz/oz/2026/09/15/wb-taxi) |
| Airports / stations | Licensed taxis got the right to stop at airports and stations and free access to paid parking for pick-up/drop-off (Apr 2025) | [R] [nuz.uz](https://nuz.uz/2025/04/02/v-uzbekistane-rasshireny-prava-nemarshrutnyh-taksi-i-uproshheny-usloviya-raboty-dlya-samozanyatyh-perevozchikov/) |

**Open legal questions for a lawyer (P0 before launch) [U]:**
1. Is SFF's Guliston→Tashkent city trip legal for a Sirdaryo-licensed driver? Tashkent city is not geographically adjacent to Sirdaryo region; Tashkent region is. Do drop-off-only trips count?
2. What is the exact procedure and timeline for aggregator integration with Soliq (fiscal receipts) and with Ministry of Transport systems?
3. Can one driver pool serve both SFF Taxi (licensed) and SFF Eats delivery (courier activity), and what does the courier need?
4. What are the current licence fee and the insurance sums?

---

## 5. Guliston & Sirdaryo region specifics

### 5.1 Population (permanent, thousand people) [V] ([Sirdaryo statistics, 27.01.2026](https://sirstat.uz/images/2025/deckbrdemog1.pdf))

| Unit | 1 Jan 2025 | 1 Jan 2026 | Centre |
|---|---|---|---|
| **Sirdaryo region** | 930.8 | **946.3** | Guliston |
| Guliston city | 102.1 | **104.6** | — |
| Yangiyer city | 49.1 | **50.2** | — |
| Shirin city | 19.4 | **19.4** | — |
| Boyovut district | 141.5 | **144.1** | Boyovut |
| Sirdaryo district (incl. Sirdaryo town, Baxt*) | 139.3 | **141.1** | Sirdaryo |
| Xovos district | 104.1 | **105.6** | Xovos |
| Sayxunobod district | 83.9 | **85.4** | Sayxun |
| Mirzaobod district | 82.3 | **83.9** | Navro'z |
| Guliston district | 81.1 | **82.2** | Dehqonobod |
| Sardoba district | 71.4 | **72.3** | Paxtaobod |
| Oqoltin district | 56.6 | **57.5** | Sardoba |

*The district capitals come from [Wikipedia](https://en.wikipedia.org/wiki/Sirdaryo_Region). Baxt is a city of district subordination, and the statistics table does not list it separately [U].
- Guliston is growing: its boundaries were expanded by 1,109 ha (mahallas Karapchi, Yangi avlod, Mevazor, Ishonch) and Shirin's by 639 ha. The Legislative Chamber approved this on 18 Aug 2026 [R] ([gazeta.uz](https://www.gazeta.uz/ru/2026/08/19/plan/)). **The service-zone polygons must be editable.**
- Density: 221.1 people/km² [V].

### 5.2 Distances from Guliston
Straight-line / approximate. Road distance is typically 10–30% longer [U] ([geo.koltyrin.ru](https://geo.koltyrin.ru/gorod.php?city=Goulistan&id=35581)):

| To | km | To | km |
|---|---|---|---|
| Dehqonobod (Guliston dist.) | 6 | Yangiyer | 28 (other sources 24–28) |
| Navro'z (Mirzaobod) | 6 | Sardoba | 30 |
| Sayxun | 22 | Xovos | 34 |
| Baxt | 23 | Sirdaryo | 36 |
| Boyovut | 27 | Shirin | ~55 (search summary, unverified) |
| Tashkent | ~120 [R] ([Wikipedia](https://en.wikipedia.org/wiki/Guliston)) | Jizzakh | ~50–60 [U] |

**Action:** compute real road distances with OSRM/Google on the actual road graph and store them as the zone-to-zone price matrix.

### 5.3 Current prices
- **City (Guliston), Yandex Start:** 4,000 so'm minimum; typical 2–7 km trips ≈5.4k–11.4k before coefficients [C] (§1.3). Launch example: 4,500 so'm [R].
- **National average legal taxi fare:** 21,785 so'm (Jan–Aug 2026, Tashkent-weighted) [R].
- **Inter-town, whole car, Yandex max:** ~71k so'm Guliston→Yangiyer [C].
- **Inter-town per-seat (Guliston–Yangiyer/Shirin/Boyovut marshrutka and shared-taxi seat prices):** **not found online [U]** → field survey.
- **Intercity per-seat:** Shirin→Tashkent 90k, Bekobod→Tashkent 80k [R]. Guliston→Tashkent: [U].

### 5.4 Demand points (seed POIs for pickup suggestions)
- **Guliston railway station** (Samarkand–Tashkent line; the city grew around the "Golodnaya Steppe" station) [R] ([Wikipedia](https://en.wikipedia.org/wiki/Guliston)).
- **Guliston avtovokzal** (bus station) and the Tashkent/Yangiyer shared-taxi stands [U — exact locations to map].
- **Guliston State University (GulDU)** — about 16.9k students reported in 2025 [R] ([search summary; guldu.uz](https://guldu.uz/uz/)); **Guliston State Pedagogical Institute** ([oliygoh.uz](https://oliygoh.uz/oliygohlar/guliston-davlat-pedagogika-instituti)).
- **Sirdaryo Regional Multidisciplinary Medical Centre** and the Guliston city medical association [R] ([goldenpages](https://www.goldenpages.uz/en/rubrics/?Id=109650)).
- Central dehqon bazaar(s), khokimiyat and government offices, the A. Khojayev Musical Drama Theatre ([spot.uz](https://www.spot.uz/oz/2024/08/28/yandex-go-gulistan/)), and district centres (Yangiyer, Shirin, Boyovut, Sirdaryo, Sayxun, Xovos, Navro'z, Paxtaobod, Sardoba, Dehqonobod).

### 5.5 Users, payments, devices
- **Cash-heavy:** 63.1% of legal taxi turnover was cash in Jan–Aug 2026, down from 76.3% cash in Jan–Jul 2025 [R] ([gazeta.uz](https://www.gazeta.uz/ru/2026/09/04/taxi/), [spot.uz](https://www.spot.uz/ru/2025/08/07/taxi)). Regions are likely more cash-heavy than Tashkent [U].
- **Smartphones:** 89% internet penetration and 33.3M mobile internet subscribers (1 Jan 2026). **Android 83.8%** → Android-first, low-end device performance matters [R] ([DataReportal](https://datareportal.com/reports/digital-2026-uzbekistan), [kun.uz](https://kun.uz/en/news/2026/08/12/number-of-mobile-internet-subscribers-in-uzbekistan-tops-33-million)). The 57% rural population and older people are the phone-order segment [H].
- **Fleet:** Cobalt 27%, Nexia 19.3%, Lacetti 16.1% (2026). Spark 12.2% and Matiz 8.5% in 2025 [R]. Damas cannot be used as a taxi under Res. 200 [V].
- **Fuel:** CNG 5,700–5,800 so'm/m³ (up 8.5–10% on 1 Jun 2026); wholesale 2,700 [R] ([spot.uz](https://www.spot.uz/ru/2026/06/01/cng-up/)).
  - Assuming ~8 m³/100 km for a Cobalt/Nexia on CNG [U], fuel costs about **460 so'm/km** [C]. That is ≈54% of Yandex's in-city 850 so'm/km cap and ≈21% of the 2,200 out-of-city rate.
  - Short city trips are marginal for drivers. The pickup fee and minimum fare carry the economics.
- **Supply:** 481,100 self-employed drivers nationally. 36% are under 30 and 6.5% work full-time (2025) [R]. **Women drivers: 4,107 (≈0.85%)** [R/C] → a "woman driver" option will have very thin supply.

---

## 6. Synthesis for SFF Taxi

### 6.1 Feature matrix

| Feature | Yandex Go (Guliston) | inDrive | MyTaxi | Local phone / Telegram dispatch | WB Taxi | **SFF Taxi plan** |
|---|---|---|---|---|---|---|
| Operates in Guliston | Yes (since 08.2024) | No (left UZ 07.2023) | Unconfirmed | Yes (informal) | No | **Yes — P0** |
| Pricing | Dynamic, max caps + demand coefficient | Passenger bid | Fixed from 24k (Tashkent) | Negotiated / habit | Dynamic + 50% cashback | **Fixed distance bands in city; fixed per-km inter-town; per-seat intercity; no surge** |
| Driver commission | 11% Start / 12% Comfort + park fee (0–1.4% ads) + 1% tax | ~10% (KZ) | n/a | 0% (or dispatcher fee, [U]) | "Reduced", undisclosed | **0% for 3 months, then 5% capped at 10k/day, or subscription; + 1% tax** |
| Cash | Yes | — | Yes | Yes (only) | Card-focused | **Yes, cash-first** |
| Uzcard/Humo | Yes | — | Card payouts | No | Yes | **P1 (Payme/Click/Uzum/Atmos acquiring)** |
| Fiscal receipt | Yes | — | Yes (integrated) | No | Required | **P0 (legal)** |
| Phone order (no smartphone) | Business/phone [U for Guliston] | No | Call centre (Tashkent) | Yes | No | **P0 operator panel** |
| Intercity per-seat | Yes (Межгород, driver sets price) | — | Out-of-town trips | Yes (Telegram) | No | **P0: scheduled routes Guliston↔Tashkent/Yangiyer/Shirin** |
| Suburb/district rides | Out-of-city 2,200/km | — | — | Yes | — | **P0 zone matrix** |
| Scheduled ride | [U] | — | [U] | Yes (by phone) | [U] | **P1** |
| Multi-stop | [U] | — | [U] | Ad hoc | [U] | **P1 (1 extra stop)** |
| Women-driver preference | No | — | No | No | No | **P2 (preference, not guarantee)** |
| Share trip / SOS | Yes | — | [U] | No | [U] | **P0 share + SOS call; P1 audio** |
| Driver photo-control | Yes | — | [U] | No | [U] | **P1 selfie check** |
| Uzbek-first UI | UZ/RU | — | UZ/RU | Voice | RU/UZ | **Uzbek Latin default, Cyrillic Uzbek + Russian** |
| Delivery with same drivers | Yandex Delivery/Eats separate | Courier (left) | Delivery class | No | Parcels en route | **P1 SFF Eats shared pool** |
| Account blocks / appeal | Opaque ("blok ochamiz" market) | — | — | — | — | **Transparent rules + human appeal in 24 h** |

### 6.2 Differentiators to win in Guliston (ranked)
1. **"Narx oldindan va o'zgarmaydi"** — fixed, published prices with no surge. Motivation: the regulator has pressured Yandex over price dynamics [R], and small-city riders value predictability [H].
2. **Low, capped driver fee.** Motivation: Yandex takes 11–12% plus park fees; parks already compete with "0%" ads [R]. Drivers stay multi-homed, so SFF only needs to be their first choice for the Guliston morning and evening peaks.
3. **Inter-town and per-seat rides** (Guliston↔district centres, Guliston↔Tashkent). This digitises the Telegram and avtovokzal market, where Yandex has only a driver-priced marketplace [R].
4. **Phone ordering via operators** for people without smartphones and the 57% rural population. Riders get an SMS with the car and plate [H].
5. **Cash-first**, with fiscal receipts handled for the driver: legal compliance comes as a feature ("SFF bilan legal ishlang").
6. **Local trust:** Uzbek-first UI, a local office, human support and a transparent block/appeal process.
7. **Shared pool with SFF Eats** — off-peak delivery keeps drivers busy, and SFF Automation handles back-office automation (payouts, receipts, reporting).
8. **Women-driver preference** — as a brand signal only. With 0.85% women drivers nationally [R/C], treat it as a best-effort preference.

### 6.3 Pricing recommendation [H] (grounded in Yandex caps, fuel cost and observed seat prices)

**Guliston city (inside the city polygon)** — fixed distance bands, price shown before ordering:

| Route distance (road) | SFF price | Yandex Start cap for comparison [C] |
|---|---|---|
| ≤2 km | 5,000 | 5,420 (2 km/6 min) |
| 2–4 km | 7,000 | 7,880 (4 km/10 min) |
| 4–7 km | 10,000 | 11,380 (7 km/15 min) |
| >7 km | 10,000 + 900/km | — |

- Free waiting 3 min, then 500/min (Yandex: 2 min free, 500/min).
- Extra stop: +2,000. Pet: +3,000. Large luggage or trunk load: +2,000.
- **Comfort class** (Gentra/Cobalt ≤5 years, AC): +25%, in line with Yandex Comfort's roughly 20–25% premium [C].
- **Night (23:00–06:00):** fixed +20%. **Holiday/weather:** a flat +2,000, announced in the app. No multiplicative surge.
- **Cancellation:** free within 2 min of assignment. After the driver arrives: 3,000 so'm, paid to the driver. Cash riders who no-show repeatedly are moved to prepay or blocked after 3 no-shows.

**Suburbs and district villages** (Dehqonobod, Navro'z and other outside-polygon addresses):
- City band price for the in-city part + **1,500 so'm/km** outside (Yandex cap: 2,200).
- Rationale: empty return, with fuel ≈460 so'm/km [C].

**Inter-town (whole car)** — zone-to-zone matrix using road km:
- **1,700 so'm/km**, minimum 25,000.
- Example: Guliston→Yangiyer ≈30 km ≈ 51,000 vs Yandex cap ≈71,000 [C].
- A return-leg discount of −30% applies if the driver is heading home (P1 "home" filter).

**Inter-town / intercity per seat** (scheduled or fill-up departures):
- Seat price = whole-car price × 0.3. The car departs at 3 seats, or at 4 for the Tashkent route. The front seat costs +10% (market practice: +10k on 80–90k, [R]).
- **Guliston→Tashkent: start pricing at 70,000 per rear seat and 80,000 front [H].** This must be validated by a 1-week field survey, anchored on Shirin→Tashkent 90k [R], because Shirin is farther from Tashkent.
- Commission on intercity: 5% (capped at 10,000 per trip).
- The legal note on licence territory applies (§4).

**Driver fee model** [H]:
- **Months 0–3: 0% platform fee.** Only the legally required 1% turnover tax is withheld and remitted.
- **After month 3, the driver chooses one of two options:**
  - (a) **Per ride 5%, capped at 10,000 so'm/day** (and 55,000/week).
  - (b) **Subscription** 9,000/day or 50,000/week for unlimited city rides. Intercity is always 5%.
- Comparison [C]: a driver grossing 150,000 so'm/day pays Yandex ≈16,500 (11%) plus the park fee. With SFF he pays 7,500 on option (a), or 9,000/10,000 at most.
- **Guaranteed shift minimum** (WB-style) for the launch cohort. Example: for 10 online hours with ≥90% acceptance at peak, SFF tops up to X so'm. Size it from the first 2 weeks of real order data. Do not promise a number before measuring.
- **Payouts:** cash rides → the driver keeps the cash, and the fee/tax is debited from a prepaid driver balance (top-up via Payme/Click). Card rides → payout to card at least daily.

**Why no surge:**
- It is a small market, and a fixed price is the brand promise.
- Supply is balanced instead with (1) night/holiday fixed add-ons, (2) driver-side peak bonuses paid from the platform fee, and (3) scheduled pre-orders.

### 6.4 Dispatch model recommendation [H]
- **City rides:** auto-assign to the best ETA with a **15 s acceptance timeout**, cascading to the next best driver (max 3).
  - After 3 misses, broadcast to all free drivers within a 3 km radius (first to accept wins).
  - Distance is road ETA from OSRM, not straight line.
  - Priority score (0–100, like Yandex's transparent model [V]) acts only as a tie-breaker within ±1 min ETA.
- **Why not bidding (inDrive):**
  - Haggling adds 1–3 min per order, and phone orders cannot bid.
  - It hurts the "fixed price" promise, and inDrive itself added fixed tariffs [R].
  - Low driver density in a ~100k city means offers stall.
- **Why not pure broadcast:** it rewards phone-tapping speed, not proximity. That raises pickup ETAs and causes disputes.
- **Inter-town and intercity:** a hybrid "trip board".
  - Drivers publish departures (time, seats, price within the SFF band ±15%). Riders book seats, and operators can book for phone callers.
  - Unfilled seats auto-offer to nearby waiting riders.
  - This matches the per-seat market habit and Yandex's Межгород design [R].
- **Delivery (SFF Eats):** batch to the same pool when there is no ride demand nearby, and never interrupt an active passenger ride.

### 6.5 Prioritised backlog

**Rider app (Android-first, Flutter/React Native; Uzbek Latin default)**

| # | Item | Pri | Size |
|---|---|---|---|
| R1 | Phone + SMS OTP sign-up, UZ/RU UI, Uzbek-Cyrillic toggle | P0 | S |
| R2 | Map pickup with snapped POIs (bazaar, vokzal, GulDU, hospital), address search in UZ/RU | P0 | M |
| R3 | Fixed price quote (zone/band engine), class choice Start/Comfort | P0 | M |
| R4 | Order tracking, driver card (photo, car, plate), masked call | P0 | M |
| R5 | Cash payment + e-fiscal receipt link | P0 | M |
| R6 | Inter-town & intercity seat booking (trip board), front-seat option | P0 | L |
| R7 | Share trip link + SOS (call 102/103 + alert to support) | P0 | S |
| R8 | Rating and complaint after ride; lost items | P0 | S |
| R9 | Card payment (Uzcard/Humo via Payme/Click/Uzum/Atmos) | P1 | M |
| R10 | Scheduled rides; 1 extra stop; comments; pet/luggage options | P1 | M |
| R11 | Promo codes, referral, SFF Eats cross-promo | P1 | S |
| R12 | Women-driver preference, child-seat option | P2 | S |
| R13 | Corporate accounts / family profiles (pay for relatives) | P2 | M |
| R14 | Loyalty points / cashback | P2 | M |

**Driver app**

| # | Item | Pri | Size |
|---|---|---|---|
| D1 | Onboarding: passport, licence card, self-employed status (JShShIR/PINFL), car docs, insurance, photos; manual verification | P0 | M |
| D2 | Online/offline, order offer with 15 s timer, navigation deep-link (Yandex Maps/Google), taximeter for waiting/extra km | P0 | L |
| D3 | Cash ride completion; balance (prepaid) with fee + 1% tax deduction; top-up via Payme/Click | P0 | M |
| D4 | Trip board: publish intercity departure, manage seats | P0 | M |
| D5 | Earnings screen, daily/weekly statement, transparent fee | P0 | S |
| D6 | Priority score (transparent), cancellation rules, appeal button | P0 | S |
| D7 | Low-end Android performance, offline-tolerant GPS buffering | P0 | M |
| D8 | "Home" destination filter (2/day), queue at vokzal/airport-style zones | P1 | M |
| D9 | Subscription purchase (day/week) | P1 | S |
| D10 | Selfie photo-control, "Conflict" recording | P1 | M |
| D11 | SFF Eats delivery orders in the same app (mode switch) | P1 | L |
| D12 | Chained next order near drop-off | P2 | M |
| D13 | Heatmap of demand, peak bonuses | P2 | M |

**Dispatcher / operator panel (web)**

| # | Item | Pri | Size |
|---|---|---|---|
| O1 | Phone order entry (caller ID lookup, saved addresses, landmark search), SMS to rider with car/plate/ETA | P0 | M |
| O2 | Live map of drivers/orders, manual assign/reassign, cancel with reason | P0 | M |
| O3 | Driver verification queue, licence expiry alerts, block/unblock with reason log | P0 | M |
| O4 | Tariff/zone editor (polygons, bands, inter-town matrix, night add-on) | P0 | M |
| O5 | Support tickets, lost & found, refunds, complaints (Competition Committee readiness) | P0 | M |
| O6 | Intercity trip board management (fill seats for callers) | P0 | S |
| O7 | Reports: trips, revenue, fees, taxes withheld, receipts status | P1 | M |
| O8 | Telephony integration (SIP/IVR, call recording), callback queue | P1 | M |
| O9 | Promo/bonus campaign manager, shift-guarantee calculator | P2 | M |

**Backend / API / integrations**

| # | Item | Pri | Size |
|---|---|---|---|
| A1 | Core order state machine (created → offered → accepted → arrived → in-trip → done / cancelled) with idempotent APIs, WebSocket/MQTT location | P0 | L |
| A2 | Dispatch service (ETA ranking, cascade, broadcast fallback) | P0 | L |
| A3 | Pricing service (bands, zone matrix, seat pricing, add-ons) — versioned tariffs | P0 | M |
| A4 | **Soliq fiscal receipt integration (OFD/e-check) + 1% tax-agent withholding & monthly remittance report** | P0 | L |
| A5 | **Ministry of Transport licence verification integration / licence card check** (manual fallback) | P0 | M–L |
| A6 | Hosting in UZ data centre for personal data (Art. 27-1) and the PD database registration | P0 | M |
| A7 | SMS gateway (Eskiz/Playmobile), maps/geocoding (OSM + Yandex/2GIS geocoder), routing (OSRM) | P0 | M |
| A8 | Payment acquiring (Payme/Click/Uzum), driver payouts to card | P1 | M |
| A9 | Shared courier/driver pool API with SFF Eats; SFF Automation webhooks | P1 | M |
| A10 | Fraud (GPS spoofing, fake rides for bonuses), anti-collusion | P1 | M |
| A11 | Public B2B API (hotels, hospitals, SFF Eats restaurants ordering rides) | P2 | M |

### 6.6 Risks & mitigations

| Risk | Type | Mitigation |
|---|---|---|
| Aggregator launched without Soliq/MinTrans integration → cannot legally operate; joint liability for unlicensed drivers | Regulatory | Start the integration process first (A4/A5). Hard-block drivers without a verified licence card. Hire a local lawyer |
| Licence-territory limits on Guliston→Tashkent trips | Regulatory | Legal opinion before launching the Tashkent route. Launch in-region inter-town first. Possibly partner with Tashkent-licensed drivers for the reverse leg |
| Personal-data localisation | Regulatory | Host in UZ (e.g. Uztelecom/local DC) and register the PD database |
| Yandex responds with local bonuses or lower commission in Guliston; WB Taxi arrives with cashback | Competitive | Compete on structural advantages (fixed prices, phone orders, seats, capped fee, local support) rather than subsidies. Lock in drivers with the capped fee and a shift guarantee |
| Thin supply at launch → no-shows (WB's main complaint [R]) | Supply | Recruit 80–120 drivers before launch (multi-homing allowed). Guarantee minimum shift earnings in peaks. Use operators to manually assign when auto-dispatch fails. Show honest ETA and allow "no car found" |
| Cash fraud / fee non-payment by drivers | Financial | Prepaid driver balance; negative balance stops offers |
| Rider safety incident | Safety | Verified drivers, share trip, SOS, masked numbers, 24/7 on-call operator, carrier insurance verified at onboarding, incident log with human review (Yandex practice [R]) |
| Driver safety (night, cash) | Safety | Rider phone verification, blacklist, night trips only for rated riders, driver SOS |
| Unit economics too thin at 5%/capped fee | Business | Shared pool with SFF Eats, low-cost ops (automation), intercity per-seat commission, B2B. Revisit after 3 months of data |
| Fuel price increases (CNG +8.5–10% in 2026 [R]) | Supply | Pricing engine with versioned tariffs. Publish fare changes 7 days ahead |
| Informal-market reaction (dispatchers/Telegram admins) | Market | Invite dispatchers as SFF operators or agents with a referral fee |

---

## 7. Next steps (research gaps to close in the field) [U]
1. Record 50+ real prices: in-city Guliston trips (bazaar↔vokzal↔GulDU), Guliston↔Yangiyer/Shirin/Boyovut/Sirdaryo seat and whole-car prices, and Guliston↔Tashkent seat price (weekday vs Friday/Sunday).
2. Count cars at the avtovokzal, railway station and bazaar stands (morning/evening). Interview 30 drivers about Yandex usage, park fee, blocks and desired fee model.
3. Check whether Yandex drivers in Guliston have chains, a "home" filter and paid shifts, and what the park fee is in practice.
4. Confirm the legal questions in §4 with a lawyer and the Sirdaryo regional transport department ([sirdaryo.mintrans.uz](https://sirdaryo.mintrans.uz/news/06032023)).
5. Verify whether Maxim, MyTaxi or local apps (Online Taxi, BizningTaxi) are actually active in Guliston.

---

## 8. Source list (primary first)
- Yandex Pro Guliston tariffs & commission (22.10.2025): https://pro.yandex.com/uz-ru/gulistan/knowledge-base/taxi/news/tariffs-changes
- Yandex Go Guliston tariff page: https://taxi.yandex.uz/ru_uz/gulistan/tariff/
- Yandex Go Tashkent tariff page: https://taxi.yandex.uz/ru_uz/tashkent/tariff/
- Yandex Pro Tashkent tariffs/commission: https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/news/tariffs-changes
- Yandex Pro Guliston news list: https://pro.yandex.com/uz-ru/gulistan/knowledge-base/taxi/news
- Yandex Pro priority (UZ): https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/app/priority-instead-of-activity
- Yandex Pro taxes 2026: https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/partners/taxes-yandex-pro
- Yandex Pro licence/self-employed: https://pro.yandex.com/uz-ru/tashkent/knowledge-base/taxi/partners/license-for-partners
- Cabinet of Ministers Resolution No. 200 (02.04.2025): https://lex.uz/ru/docs/7459068 , https://www.lex.uz/uz/docs/-7459068
- PP-4742 (08.06.2020): https://lex.uz/docs/4849605?ONDATE=01.01.2024 ; PP-311 (07.07.2022): https://lex.uz/ru/docs/6100009
- Carrier liability insurance law: https://www.lex.uz/acts/2652781
- Sirdaryo statistics demographic release (27.01.2026): https://sirstat.uz/images/2025/deckbrdemog1.pdf
- Legal taxi market Jan–Aug 2026: https://www.gazeta.uz/ru/2026/09/04/taxi/ ; Jan–Jul 2025: https://www.spot.uz/ru/2025/08/07/taxi
- Yandex Go Guliston launch: https://www.spot.uz/oz/2024/08/28/yandex-go-gulistan/ , https://www.gazeta.uz/oz/2024/08/28/guliston/
- Yandex Межгород: https://www.spot.uz/ru/2026/05/06/yandex-go/
- Yandex safety policy: https://www.gazeta.uz/ru/2026/07/06/yandex-taxi/
- Yandex dominance: https://www.gazeta.uz/ru/2023/12/08/yandex/ ; price warning: https://podrobno.uz/cat/obchestvo/komitet-po-konkurentsii-predupredil-yandex-go-o-neobkhodimosti-snizheniya-tsen-/
- Yandex loyalty 2026: https://www.spot.uz/oz/2026/02/25/yandex/ ; licence territory: https://www.spot.uz/oz/2025/06/13/taxi-restrictions/
- Fiscal receipts: https://www.spot.uz/ru/2024/02/21/fiscalization/ ; 2026 taxation: https://www.spot.uz/oz/2026/01/02/taxi-taxation
- WB Taxi: https://www.spot.uz/ru/2026/03/23/wb-taxi/ , https://www.gazeta.uz/ru/2026/07/13/wb-taxi/ , https://www.spot.uz/oz/2026/09/15/wb-taxi , https://click-or-die.ru/2026/05/kogda-v-rossii-zapustyat-wb-taxi-vot-chto-izvestno-ob-agregatore-taksi-kotoryj-uzhe-rabotaet-v-belorussii-i-uzbekistane/
- inDrive exit: https://www.spot.uz/oz/2023/07/31/indrive-stop/
- Uklon expansion: https://uklon.com.ua/en/news/uklon-expands-into-the-fergana-valley-launching-in-five-new-cities-across-uzbekistan/
- MyTaxi driver plans: https://drivers.mytaxi.uz/ru/plans
- GO TOSHKENT per-seat prices: https://site.gotoshkent.uz/?lang=en
- OLX Guliston Yandex park ads: https://www.olx.uz/oz/gulistan/q-taksi/
- Methane price 2026: https://www.spot.uz/ru/2026/06/01/cng-up/
- DataReportal Digital 2026 Uzbekistan: https://datareportal.com/reports/digital-2026-uzbekistan
- Data localisation: https://www.loc.gov/item/global-legal-monitor/2021-05-07/uzbekistan-new-requirements-for-uzbek-citizens-personal-data-localization-enter-into-force/ , https://www.gazeta.uz/en/2026/01/21/data/
- Guliston/Sirdaryo boundary expansion: https://www.gazeta.uz/ru/2026/08/19/plan/
- Distances: https://geo.koltyrin.ru/gorod.php?city=Goulistan&id=35581
