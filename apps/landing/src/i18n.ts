/**
 * Every text of the site in Uzbek (Latin, the default) and Russian. The HTML pages reference
 * keys as `{{t:key}}` (escaped) or `{{{t:key}}}` (HTML allowed; keys end in `_html`): the
 * build fills the Uzbek text in, so the pages are complete static documents without
 * JavaScript, and `lang.ts` swaps the texts at runtime when the visitor chooses Russian.
 */

export type Lang = 'uz' | 'ru';
export const LANGS: readonly Lang[] = ['uz', 'ru'];
export const DEFAULT_LANG: Lang = 'uz';

type Entry = { uz: string; ru: string };

export const dict = {
  // --- shared chrome -------------------------------------------------------------------
  'site.name': { uz: 'SFF Taxi', ru: 'SFF Taxi' },
  'site.title': {
    uz: 'SFF Taxi — Guliston taksisi: qat’iy narx, surge yo‘q',
    ru: 'SFF Taxi — такси Гулистана: фиксированная цена, без наценок',
  },
  'site.description': {
    uz: 'Guliston va Sirdaryo viloyati uchun taksi ilovasi: narx buyurtmadan oldin ko‘rinadi va yo‘lda o‘zgarmaydi. Ekonom, Komfort, shaharlararo o‘rindiq, yuk va yetkazib berish. Haydovchilar uchun past komissiya.',
    ru: 'Приложение такси для Гулистана и Сырдарьинской области: цена видна до заказа и не меняется в пути. Эконом, Комфорт, межгород по местам, грузы и доставка. Низкая комиссия для водителей.',
  },
  'nav.services': { uz: 'Xizmatlar', ru: 'Услуги' },
  'nav.prices': { uz: 'Narxlar', ru: 'Цены' },
  'nav.safety': { uz: 'Xavfsizlik', ru: 'Безопасность' },
  'nav.drivers': { uz: 'Haydovchilarga', ru: 'Водителям' },
  'nav.faq': { uz: 'Savollar', ru: 'Вопросы' },
  'nav.download': { uz: 'Ilovani yuklash', ru: 'Скачать' },
  'nav.menu': { uz: 'Menyu', ru: 'Меню' },
  'lang.switch': { uz: 'Русский', ru: 'O‘zbekcha' },
  'lang.label': { uz: 'Til', ru: 'Язык' },
  'cta.play': { uz: 'Google Play', ru: 'Google Play' },
  'cta.appstore': { uz: 'App Store', ru: 'App Store' },
  'cta.playSub': { uz: 'Android uchun', ru: 'для Android' },
  'cta.appstoreSub': { uz: 'iPhone uchun', ru: 'для iPhone' },
  'cta.soon': { uz: 'Tez kunda', ru: 'Скоро' },
  'cta.call': { uz: 'Qo‘ng‘iroq qilish', ru: 'Позвонить' },
  'cta.callOrder': { uz: 'Telefon orqali buyurtma', ru: 'Заказ по телефону' },
  'cta.telegram': { uz: 'Telegram', ru: 'Telegram' },
  'cta.copy': { uz: 'Nusxa olish', ru: 'Скопировать' },
  'cta.copied': { uz: 'Nusxa olindi', ru: 'Скопировано' },
  'cta.openApp': { uz: 'Ilovada ochish', ru: 'Открыть в приложении' },
  'cta.back': { uz: 'Bosh sahifa', ru: 'На главную' },

  // --- hero ----------------------------------------------------------------------------
  'hero.kicker': {
    uz: 'Guliston · Sirdaryo viloyati',
    ru: 'Гулистан · Сырдарьинская область',
  },
  'hero.title': {
    uz: 'Guliston taksisi — qat’iy narx, surge yo‘q',
    ru: 'Такси Гулистана — фиксированная цена, без наценок',
  },
  'hero.sub': {
    uz: 'Narx buyurtma berishdan oldin ko‘rinadi va yo‘lda o‘zgarmaydi. Yomg‘irda ham, bayramda ham. Naqd yoki karta, tekshirilgan haydovchilar, telefon orqali ham buyurtma.',
    ru: 'Цена видна до заказа и не меняется в пути — ни в дождь, ни в праздник. Наличные или карта, проверенные водители, заказ по телефону тоже работает.',
  },
  'hero.badge1': { uz: 'Narx oldindan ma’lum', ru: 'Цена известна заранее' },
  'hero.badge2': { uz: 'Naqd va karta', ru: 'Наличные и карта' },
  'hero.badge3': { uz: 'Tekshirilgan haydovchilar', ru: 'Проверенные водители' },
  'hero.from': { uz: 'Shahar ichida', ru: 'По городу' },
  'hero.fromPrice': { uz: '5 000 so‘mdan', ru: 'от 5 000 сум' },
  'hero.phoneHint': {
    uz: 'Smartfon bo‘lmasa ham bo‘ladi: operatorga qo‘ng‘iroq qiling, mashina va raqamini SMS da yuboramiz.',
    ru: 'Без смартфона тоже можно: позвоните оператору, машину и номер пришлём по SMS.',
  },

  // --- launch promo --------------------------------------------------------------------
  'promo.kicker': { uz: 'Ochilish aksiyasi', ru: 'Акция к запуску' },
  'promo.title_html': {
    uz: 'Birinchi safarga <mark>50% chegirma</mark>',
    ru: '<mark>Скидка 50%</mark> на первую поездку',
  },
  'promo.text': {
    uz: 'Ilovani o‘rnating, «Promokod» bo‘limiga GULISTON deb yozing — birinchi safaringiz 50% arzon (10 000 so‘mgacha). Aksiya 2026-yil 31-dekabrgacha.',
    ru: 'Установите приложение, введите в разделе «Промокод» слово GULISTON — первая поездка на 50% дешевле (до 10 000 сум). Акция до 31 декабря 2026 года.',
  },
  'promo.code': { uz: 'Promokod', ru: 'Промокод' },
  'promo.referralTitle': { uz: 'Do‘stni taklif qiling', ru: 'Пригласите друга' },
  'promo.referralText': {
    uz: 'Ilovadagi shaxsiy kodingizni ulashing: do‘stingizga birinchi safarga 50% (10 000 so‘mgacha), sizga uning birinchi safaridan keyin 10 000 so‘m bonus.',
    ru: 'Поделитесь личным кодом из приложения: другу — 50% на первую поездку (до 10 000 сум), вам — бонус 10 000 сум после его первой поездки.',
  },

  // --- services ------------------------------------------------------------------------
  'services.title': { uz: 'Xizmatlar', ru: 'Услуги' },
  'services.sub': {
    uz: 'Bitta ilova — shahar ichidagi safardan tortib Toshkentga o‘rindiq va yuk tashishgacha.',
    ru: 'Одно приложение — от поездки по городу до места до Ташкента и перевозки грузов.',
  },
  'services.economy': { uz: 'Ekonom', ru: 'Эконом' },
  'services.economyText': {
    uz: 'Arzon va tez: Cobalt, Nexia, Gentra. 4 kishigacha.',
    ru: 'Дёшево и быстро: Cobalt, Nexia, Gentra. До 4 человек.',
  },
  'services.comfort': { uz: 'Komfort', ru: 'Комфорт' },
  'services.comfortText': {
    uz: 'Yangiroq mashina (5 yoshgacha), konditsioner. Taxminan +25%.',
    ru: 'Машина поновее (до 5 лет), кондиционер. Примерно +25%.',
  },
  'services.minivan': { uz: 'Miniven', ru: 'Минивэн' },
  'services.minivanText': {
    uz: '6 kishigacha va katta yuk: Orlando, Carnival.',
    ru: 'До 6 человек и большой багаж: Orlando, Carnival.',
  },
  'services.business': { uz: 'Biznes', ru: 'Бизнес' },
  'services.businessText': {
    uz: 'Premium mashina, reytingi 4,8+ bo‘lgan haydovchi.',
    ru: 'Премиум-автомобиль, водитель с рейтингом 4,8+.',
  },
  'services.shared': { uz: 'Hamroh bilan', ru: 'Совместная поездка' },
  'services.sharedText': {
    uz: 'Yo‘li bir xil yo‘lovchi bilan birga — 15% arzon, yo‘ldosh topilmasa ham chegirmaning yarmi sizniki.',
    ru: 'С попутчиком по пути — на 15% дешевле; не нашёлся попутчик — половина скидки всё равно ваша.',
  },
  'services.intercity': { uz: 'Shaharlararo', ru: 'Межгород' },
  'services.intercityText': {
    uz: 'Yangiyer, Sirdaryo, Boyovut, Toshkent: butun mashina yoki o‘rindiq. Haydovchi reysini e’lon qiladi, siz joy band qilasiz.',
    ru: 'Янгиер, Сырдарья, Баяут, Ташкент: вся машина или место. Водитель публикует рейс, вы бронируете место.',
  },
  'services.cargo': { uz: 'Yuk tashish', ru: 'Грузоперевозки' },
  'services.cargoText': {
    uz: 'Labo, Damas-yuk, Porter: 700 kg va 1,5 t gacha, yuk tashuvchilar bilan.',
    ru: 'Labo, Porter: до 700 кг и до 1,5 т, с грузчиками по желанию.',
  },
  'services.delivery': { uz: 'Yetkazib berish', ru: 'Доставка' },
  'services.deliveryText': {
    uz: 'Hujjat, posilka, dorini shahar bo‘ylab 10 kg gacha — taksi narxida.',
    ru: 'Документы, посылки, лекарства по городу до 10 кг — по цене такси.',
  },
  'services.women': { uz: 'Ayol haydovchi', ru: 'Женщина-водитель' },
  'services.womenText': {
    uz: 'Ayollar buyurtmada «Ayol haydovchi»ni tanlashi mumkin (imkon bo‘lganda).',
    ru: 'Женщины могут выбрать «Женщина-водитель» при заказе (при наличии).',
  },
  'services.soon': { uz: 'Tez kunda', ru: 'Скоро' },
  'services.more': { uz: 'Yana', ru: 'Ещё' },
  'services.moreList_html': {
    uz: '<li>Oldindan buyurtma (kuni va soatini tanlang)</li><li>Oraliq manzil — ikkitagacha to‘xtash</li><li>Boshqa odam uchun buyurtma</li><li>Bola o‘rindig‘i, katta yuk, uy hayvoni</li><li>Haydovchi bilan ilova ichida chat</li>',
    ru: '<li>Предзаказ на дату и время</li><li>Промежуточные остановки — до двух</li><li>Заказ для другого человека</li><li>Детское кресло, большой багаж, питомцы</li><li>Чат с водителем внутри приложения</li>',
  },

  // --- prices --------------------------------------------------------------------------
  'prices.title': { uz: 'Narxlar', ru: 'Цены' },
  'prices.sub': {
    uz: 'Shahar ichida narx yo‘lning uzunligiga qarab belgilangan va ilovada buyurtmadan oldin ko‘rsatiladi. Talab oshganda narx ko‘tarilmaydi.',
    ru: 'По городу цена зависит от длины маршрута и показывается до заказа. При высоком спросе цена не растёт.',
  },
  'prices.live': { uz: 'Amaldagi tarif', ru: 'Действующий тариф' },
  'prices.static': {
    uz: 'Ochilish tarifi (ilovada aniq narx ko‘rsatiladi)',
    ru: 'Тариф запуска (точную цену покажет приложение)',
  },
  'prices.colDistance': { uz: 'Masofa (yo‘l bo‘yicha)', ru: 'Расстояние (по дороге)' },
  'prices.upTo': { uz: '{km} km gacha', ru: 'до {km} км' },
  'prices.beyond': { uz: 'Keyin har km', ru: 'Далее за км' },
  'prices.rules': { uz: 'Qoidalar', ru: 'Правила' },
  'prices.night': {
    uz: 'Tungi vaqt ({from}–{to}): +{percent}%, qat’iy ustama — koeffitsiyent emas.',
    ru: 'Ночью ({from}–{to}): +{percent}%, фиксированная надбавка, а не коэффициент.',
  },
  'prices.waiting': {
    uz: 'Kutish: {free} daqiqa bepul, keyin {perMin} so‘m/daqiqa.',
    ru: 'Ожидание: {free} мин бесплатно, затем {perMin} сум/мин.',
  },
  'prices.outside': {
    uz: 'Shahar tashqarisi (qishloq, tuman): yo‘lning shahar tashqarisidagi qismi uchun {perKm} so‘m/km.',
    ru: 'За городом (сёла, район): {perKm} сум/км за часть пути вне города.',
  },
  'prices.intercity': {
    uz: 'Shaharlararo butun mashina: {perKm} so‘m/km, kamida {min} so‘m. O‘rindiq — mashina narxining ~{seat}% i.',
    ru: 'Межгород, вся машина: {perKm} сум/км, минимум {min} сум. Место — около {seat}% от цены машины.',
  },
  'prices.cancel': {
    uz: 'Bekor qilish: haydovchi kelib, bepul kutish tugaguncha — bepul; keyin {fee} so‘m (haydovchiga).',
    ru: 'Отмена: бесплатно, пока водитель не приехал и не вышло бесплатное ожидание; затем {fee} сум (водителю).',
  },
  'prices.stops': {
    uz: 'Oraliq manzil: har biri {fee} so‘m, {free} daqiqa bepul kutish.',
    ru: 'Промежуточная остановка: {fee} сум каждая, {free} мин бесплатного ожидания.',
  },
  'prices.options': {
    uz: 'Bola o‘rindig‘i {child}, katta yuk {luggage}, uy hayvoni {pets} so‘m.',
    ru: 'Детское кресло {child}, большой багаж {luggage}, питомец {pets} сум.',
  },
  'prices.examplesTitle': { uz: 'Misollar', ru: 'Примеры' },
  'prices.example1': {
    uz: 'Shahar markazi ichida, ~2 km',
    ru: 'Внутри центра города, ~2 км',
  },
  'prices.example2': {
    uz: 'Vokzaldan bozorgacha, ~4 km',
    ru: 'От вокзала до базара, ~4 км',
  },
  'prices.example3': {
    uz: 'Shaharning bir chetidan ikkinchisiga, ~7 km',
    ru: 'Через весь город, ~7 км',
  },
  'prices.exampleIntercity': {
    uz: 'Guliston → Yangiyer, ~30 km, butun mashina',
    ru: 'Гулистан → Янгиер, ~30 км, вся машина',
  },
  'prices.receipt': {
    uz: 'Har bir safar uchun elektron chek beriladi. Narx yo‘lda faqat kutish va qo‘shimcha to‘xtash uchun o‘zgaradi — siz buni ilovada ko‘rib turasiz.',
    ru: 'На каждую поездку выдаётся электронный чек. В пути цена меняется только за ожидание и дополнительные остановки — вы видите это в приложении.',
  },
  'prices.updated': { uz: 'Yangilangan', ru: 'Обновлено' },

  // --- safety --------------------------------------------------------------------------
  'safety.title': { uz: 'Xavfsizlik', ru: 'Безопасность' },
  'safety.sub': {
    uz: 'Kichik shaharda ishonch hammasidan muhim. Shuning uchun har bir haydovchini o‘zimiz tekshiramiz.',
    ru: 'В небольшом городе доверие важнее всего. Поэтому каждого водителя мы проверяем сами.',
  },
  'safety.verified': { uz: 'Tekshirilgan haydovchilar', ru: 'Проверенные водители' },
  'safety.verifiedText': {
    uz: 'Pasport, haydovchilik guvohnomasi, litsenziya kartochkasi va mashina hujjatlarini operatorlarimiz ko‘rib chiqadi. Faqat litsenziyali, o‘zini o‘zi band qilgan haydovchilar ishlaydi.',
    ru: 'Паспорт, водительское удостоверение, лицензионную карточку и документы на машину проверяют наши операторы. Работают только лицензированные самозанятые водители.',
  },
  'safety.share': { uz: 'Safarni ulashish', ru: 'Поделиться поездкой' },
  'safety.shareText': {
    uz: 'Yaqinlaringizga havola yuboring: ular mashinani, raqamini va joylashuvini jonli ko‘rib turadi. Safar tugagach havola o‘chadi.',
    ru: 'Отправьте близким ссылку: они видят машину, номер и её положение в реальном времени. После поездки ссылка перестаёт работать.',
  },
  'safety.sos': { uz: 'SOS tugmasi', ru: 'Кнопка SOS' },
  'safety.sosText': {
    uz: 'Bir bosishda operatorlarga joylashuvingiz bilan signal boradi, 112 / 102 / 103 raqamlari qo‘lingizda.',
    ru: 'Одно нажатие — сигнал с вашим местоположением уходит операторам, номера 112 / 102 / 103 под рукой.',
  },
  'safety.rating': { uz: 'Baho va shikoyat', ru: 'Оценки и жалобы' },
  'safety.ratingText': {
    uz: 'Har safardan keyin ikki tomonlama baho. Shikoyat (yo‘qolgan buyum, xulq, narx) 7 kun ichida ilovadan — javobni operator beradi.',
    ru: 'После каждой поездки — оценка с обеих сторон. Жалоба (забытая вещь, поведение, цена) из приложения в течение 7 дней — отвечает оператор.',
  },
  'safety.privacy': { uz: 'Raqamingiz yashirin', ru: 'Ваш номер скрыт' },
  'safety.privacyText': {
    uz: 'Haydovchi bilan ilova ichidagi chatda yozishasiz; safar havolasida telefon raqamlari ko‘rinmaydi. Ma’lumotlar O‘zbekistondagi serverlarda saqlanadi.',
    ru: 'С водителем вы переписываетесь в чате приложения; в ссылке на поездку нет номеров телефонов. Данные хранятся на серверах в Узбекистане.',
  },
  'safety.legal': { uz: 'Qonuniy va shaffof', ru: 'Легально и прозрачно' },
  'safety.legalText': {
    uz: 'Har safar uchun elektron chek, 1% soliq haydovchi uchun avtomatik hisoblanadi. Narx haqida bahsga o‘rin yo‘q: u oldindan kelishilgan.',
    ru: 'Электронный чек на каждую поездку, налог 1% для водителя начисляется автоматически. Спорить о цене не о чем: она согласована заранее.',
  },

  // --- drivers -------------------------------------------------------------------------
  'drivers.kicker': { uz: 'Haydovchilar uchun', ru: 'Водителям' },
  'drivers.title': {
    uz: 'Ko‘proq daromad — kam komissiya',
    ru: 'Больше заработка — меньше комиссия',
  },
  'drivers.sub': {
    uz: 'Yandex 11–12% oladi. Bizda 2026-yil oxirigacha 0%, keyin 5% — kuniga ko‘pi bilan 10 000 so‘m, yoki kunlik/haftalik obuna. Naqd pul sizda qoladi.',
    ru: 'Yandex берёт 11–12%. У нас до конца 2026 года 0%, затем 5% — не больше 10 000 сум в день, или подписка на день/неделю. Наличные остаются у вас.',
  },
  'drivers.stat1': { uz: '0%', ru: '0%' },
  'drivers.stat1Text': { uz: 'komissiya 31.12.2026 gacha', ru: 'комиссия до 31.12.2026' },
  'drivers.stat2': { uz: '5%', ru: '5%' },
  'drivers.stat2Text': {
    uz: 'keyin, kuniga 10 000 so‘mdan oshmaydi',
    ru: 'затем, не больше 10 000 сум в день',
  },
  'drivers.stat3': { uz: '9 000 / 50 000', ru: '9 000 / 50 000' },
  'drivers.stat3Text': {
    uz: 'kunlik / haftalik cheksiz obuna',
    ru: 'подписка на день / неделю без лимита',
  },
  'drivers.benefits_html': {
    uz: '<li><b>Qat’iy narx</b> — yo‘lovchi bilan tortishuv yo‘q, kutish va bekor qilish pullik.</li><li><b>Naqd sizda qoladi</b>: komissiya va 1% soliq oldindan to‘ldirilgan balansdan yechiladi (Payme/Click yoki ofisda naqd).</li><li><b>Elektron chek va soliq</b> — ilova o‘zi yuboradi, hisobot sizdan talab qilinmaydi.</li><li><b>Shaharlararo reys</b>: o‘zingiz narx va vaqt e’lon qilasiz, o‘rindiqlar ilovada to‘ladi. Komissiya 5%, reysiga 10 000 so‘mdan oshmaydi.</li><li><b>Uyga qaytish filtri</b>, yuk va yetkazib berish buyurtmalari — bo‘sh yurmaysiz.</li><li><b>Ochiq ustuvorlik</b>: buyurtmalar yaqinlik va reyting bo‘yicha, hamma qoidasi ilovada yozilgan.</li>',
    ru: '<li><b>Фиксированная цена</b> — никаких споров с пассажиром, ожидание и отмена оплачиваются.</li><li><b>Наличные остаются у вас</b>: комиссия и налог 1% списываются с предоплаченного баланса (Payme/Click или наличными в офисе).</li><li><b>Электронный чек и налог</b> — приложение отправляет само, отчётность с вас не требуется.</li><li><b>Межгород</b>: сами назначаете цену и время, места заполняются в приложении. Комиссия 5%, не больше 10 000 сум за рейс.</li><li><b>Фильтр «домой»</b>, грузы и доставка — не ездите порожняком.</li><li><b>Прозрачный приоритет</b>: заказы по близости и рейтингу, все правила написаны в приложении.</li>',
  },
  'drivers.howTitle': { uz: 'Qanday boshlash', ru: 'Как начать' },
  'drivers.step1': {
    uz: '«SFF Taxi Haydovchi» ilovasini yuklang',
    ru: 'Скачайте «SFF Taxi Haydovchi»',
  },
  'drivers.step1Text': {
    uz: 'Telefon raqamingiz bilan kiring.',
    ru: 'Войдите по номеру телефона.',
  },
  'drivers.step2': { uz: 'Hujjatlarni suratga oling', ru: 'Сфотографируйте документы' },
  'drivers.step2Text': {
    uz: 'Pasport, haydovchilik guvohnomasi, litsenziya kartochkasi, texpasport, mashina va o‘zingizning suratingiz.',
    ru: 'Паспорт, водительское удостоверение, лицензионную карточку, техпаспорт, фото машины и своё фото.',
  },
  'drivers.step3': { uz: 'Operator tekshiradi', ru: 'Оператор проверяет' },
  'drivers.step3Text': {
    uz: 'Odatda bir ish kuni ichida. Savol bo‘lsa — qo‘ng‘iroq qilamiz.',
    ru: 'Обычно в течение одного рабочего дня. Если есть вопросы — позвоним.',
  },
  'drivers.step4': { uz: 'Liniyaga chiqing', ru: 'Выходите на линию' },
  'drivers.step4Text': {
    uz: 'Balansni to‘ldiring va birinchi buyurtmani qabul qiling.',
    ru: 'Пополните баланс и примите первый заказ.',
  },
  'drivers.reqTitle': { uz: 'Talablar', ru: 'Требования' },
  'drivers.req_html': {
    uz: '<li>21 yoshdan katta, «B» toifa, kamida 3 yil staj</li><li>O‘zini o‘zi band qilgan shaxs va yo‘lovchi tashish litsenziya kartochkasi (yordam beramiz)</li><li>Mashina 15 yoshdan oshmagan, sug‘urta polisi bor</li><li>Komfort uchun: 5 yoshgacha, konditsioner</li>',
    ru: '<li>Старше 21 года, категория «B», стаж от 3 лет</li><li>Статус самозанятого и лицензионная карточка на перевозку пассажиров (поможем оформить)</li><li>Автомобиль не старше 15 лет, есть страховка</li><li>Для Комфорта: не старше 5 лет, кондиционер</li>',
  },
  'drivers.cta': { uz: 'Haydovchi ilovasini yuklash', ru: 'Скачать приложение водителя' },
  'drivers.ctaCall': {
    uz: 'Yoki ofisga keling — ro‘yxatdan o‘tishda yordam beramiz',
    ru: 'Или приходите в офис — поможем зарегистрироваться',
  },

  // --- download ------------------------------------------------------------------------
  'download.title': { uz: 'Ilovani yuklab oling', ru: 'Скачайте приложение' },
  'download.sub': {
    uz: 'Yo‘lovchilar uchun «SFF Taxi», haydovchilar uchun «SFF Taxi Haydovchi». Bepul, o‘zbek va rus tillarida.',
    ru: 'Для пассажиров — «SFF Taxi», для водителей — «SFF Taxi Haydovchi». Бесплатно, на узбекском и русском.',
  },
  'download.rider': { uz: 'Yo‘lovchi ilovasi', ru: 'Приложение пассажира' },
  'download.driver': { uz: 'Haydovchi ilovasi', ru: 'Приложение водителя' },
  'download.orCall': {
    uz: 'Ilovasiz buyurtma — operator telefoni:',
    ru: 'Заказ без приложения — телефон оператора:',
  },

  // --- FAQ -----------------------------------------------------------------------------
  'faq.title': { uz: 'Ko‘p so‘raladigan savollar', ru: 'Частые вопросы' },
  'faq.q1': { uz: 'Narx haqiqatan o‘zgarmaydimi?', ru: 'Цена правда не меняется?' },
  'faq.a1': {
    uz: 'Ha. Narx buyurtmadan oldin hisoblanadi va safar davomida saqlanadi. Faqat haydovchi kelgach bepul daqiqalardan ortiq kutish va siz qo‘shgan oraliq to‘xtashlar qo‘shiladi — ikkalasi ham ilovada ko‘rinib turadi. Talab oshganda narx ko‘tariladigan «surge» bizda yo‘q.',
    ru: 'Да. Цена считается до заказа и сохраняется на всю поездку. Добавляется только ожидание сверх бесплатных минут после приезда водителя и добавленные вами остановки — и то, и другое видно в приложении. «Surge» при высоком спросе у нас нет.',
  },
  'faq.q2': { uz: 'Qanday to‘lash mumkin?', ru: 'Как можно оплатить?' },
  'faq.a2': {
    uz: 'Naqd — haydovchiga. Karta — Payme yoki Click orqali ilovada (Uzcard, Humo). Shaharlararo o‘rindiqni band qilishda narxning bir qismi karta bilan oldindan to‘lanadi.',
    ru: 'Наличными — водителю. Картой — через Payme или Click в приложении (Uzcard, Humo). При бронировании места на межгород часть цены оплачивается картой заранее.',
  },
  'faq.q3': {
    uz: 'Smartfonim yo‘q yoki internet yo‘q. Buyurtma bera olamanmi?',
    ru: 'У меня нет смартфона или интернета. Можно заказать?',
  },
  'faq.a3': {
    uz: 'Ha, operatorga qo‘ng‘iroq qiling. Operator buyurtmani kiritadi, sizga mashina, raqami va yetib kelish vaqti SMS da keladi.',
    ru: 'Да, позвоните оператору. Он оформит заказ, а вам придёт SMS с машиной, номером и временем прибытия.',
  },
  'faq.q4': { uz: 'Promokodni qayerga yozaman?', ru: 'Куда вводить промокод?' },
  'faq.a4': {
    uz: 'Ilovada Profil → «Promokod va bonuslar» yoki buyurtma oynasidagi «Promokod» qatoriga. GULISTON kodi birinchi safarga amal qiladi; do‘stingizning taklif kodi ham shu yerga yoziladi.',
    ru: 'В приложении: Профиль → «Промокоды и бонусы» или строка «Промокод» на экране заказа. Код GULISTON действует на первую поездку; код приглашения от друга вводится там же.',
  },
  'faq.q5': { uz: 'Qaysi hududlarda ishlaydi?', ru: 'Где работает сервис?' },
  'faq.a5': {
    uz: 'Guliston shahri va atrofidagi qishloqlar; shaharlararo reyslar Sirdaryo viloyati tumanlari va Toshkent yo‘nalishida. Hududlar kengayib boradi.',
    ru: 'Город Гулистан и окрестные сёла; межгородские рейсы по районам Сырдарьинской области и в направлении Ташкента. География расширяется.',
  },
  'faq.q6': {
    uz: 'Buyumimni mashinada unutib qoldirdim. Nima qilay?',
    ru: 'Я забыл вещь в машине. Что делать?',
  },
  'faq.a6': {
    uz: 'Ilovada safar tarixidan «Shikoyat → Yo‘qolgan buyum»ni tanlang yoki operatorga qo‘ng‘iroq qiling — haydovchi bilan bog‘lab beramiz.',
    ru: 'В истории поездок выберите «Жалоба → Забытая вещь» или позвоните оператору — свяжем с водителем.',
  },
  'faq.q7': {
    uz: 'Haydovchi uchun komissiya qanday yechiladi?',
    ru: 'Как списывается комиссия у водителя?',
  },
  'faq.a7': {
    uz: 'Naqd safarda pul sizda qoladi; komissiya (aksiya davrida 0%) va 1% soliq ilovadagi balansdan yechiladi. Karta safarida to‘liq narx balansingizga tushadi. Balans Payme/Click yoki ofisda naqd to‘ldiriladi.',
    ru: 'В поездке за наличные деньги остаются у вас; комиссия (0% в период акции) и налог 1% списываются с баланса в приложении. В поездке по карте полная цена зачисляется на баланс. Пополнение — Payme/Click или наличными в офисе.',
  },

  // --- footer --------------------------------------------------------------------------
  'footer.company': { uz: 'Kompaniya', ru: 'Компания' },
  'footer.legalName': { uz: 'Yuridik nomi', ru: 'Юридическое лицо' },
  'footer.inn': { uz: 'STIR (INN)', ru: 'ИНН' },
  'footer.address': { uz: 'Manzil', ru: 'Адрес' },
  'footer.contacts': { uz: 'Aloqa', ru: 'Контакты' },
  'footer.docs': { uz: 'Hujjatlar', ru: 'Документы' },
  'footer.privacy': { uz: 'Maxfiylik siyosati', ru: 'Политика конфиденциальности' },
  'footer.terms': { uz: 'Foydalanish shartlari', ru: 'Условия использования' },
  'footer.note': {
    uz: 'SFF Taxi — yo‘lovchilarni litsenziyali tashuvchilar bilan bog‘lovchi axborot xizmati (VM qarori №200, 02.04.2025). Narxlar ma’lumot uchun; aniq narx buyurtmada ko‘rsatiladi.',
    ru: 'SFF Taxi — информационный сервис, соединяющий пассажиров с лицензированными перевозчиками (ПКМ №200 от 02.04.2025). Цены справочные; точная цена показывается при заказе.',
  },
  'footer.rights': { uz: 'Barcha huquqlar himoyalangan.', ru: 'Все права защищены.' },

  // --- invite page ---------------------------------------------------------------------
  'invite.title': {
    uz: 'Do‘stingiz sizni SFF Taxiga taklif qildi',
    ru: 'Друг пригласил вас в SFF Taxi',
  },
  'invite.sub': {
    uz: 'Taklif kodi bilan birinchi safaringizga 50% chegirma (10 000 so‘mgacha). Kod faqat birinchi safargacha, bir marta kiritiladi.',
    ru: 'С кодом приглашения — скидка 50% на первую поездку (до 10 000 сум). Код вводится один раз, до первой поездки.',
  },
  'invite.codeLabel': { uz: 'Taklif kodi', ru: 'Код приглашения' },
  'invite.opening': {
    uz: 'Ilova ochilmoqda… Ochilmasa, uni o‘rnating va kodni qo‘lda kiriting.',
    ru: 'Открываем приложение… Если не открылось, установите его и введите код вручную.',
  },
  'invite.howTitle': { uz: 'Qanday ishlatiladi', ru: 'Как применить' },
  'invite.how_html': {
    uz: '<li>Ilovani o‘rnating va telefon raqamingiz bilan kiring.</li><li>Profil → «Promokod va bonuslar» → kodni yozing (Android’da ko‘pincha o‘zi to‘ladi).</li><li>Birinchi safarni buyurtma qiling — chegirma narxda ko‘rinadi.</li>',
    ru: '<li>Установите приложение и войдите по номеру телефона.</li><li>Профиль → «Промокоды и бонусы» → введите код (на Android он часто подставляется сам).</li><li>Закажите первую поездку — скидка отразится в цене.</li>',
  },
  'invite.invalid': {
    uz: 'Havolada kod topilmadi. Do‘stingizdan kodni so‘rang yoki ilovani shunchaki o‘rnating.',
    ru: 'В ссылке нет кода. Попросите код у друга или просто установите приложение.',
  },

  // --- promo page ----------------------------------------------------------------------
  'promoPage.title': { uz: 'Sizga promokod', ru: 'Ваш промокод' },
  'promoPage.sub': {
    uz: 'Ilovada «Promokod» qatoriga yozing — chegirma keyingi mos safarda narxda ko‘rinadi. Shartlar ilovada kod yonida yoziladi.',
    ru: 'Введите в строке «Промокод» в приложении — скидка отразится в цене подходящей поездки. Условия показываются рядом с кодом.',
  },
  'promoPage.codeLabel': { uz: 'Promokod', ru: 'Промокод' },

  // --- share-trip page -----------------------------------------------------------------
  'share.title': { uz: 'Safar jonli', ru: 'Поездка в реальном времени' },
  'share.loading': { uz: 'Yuklanmoqda…', ru: 'Загрузка…' },
  'share.notFound': {
    uz: 'Havola topilmadi yoki noto‘g‘ri.',
    ru: 'Ссылка не найдена или неверна.',
  },
  'share.ended': {
    uz: 'Safar yakunlangan — havola endi ishlamaydi.',
    ru: 'Поездка завершена — ссылка больше не работает.',
  },
  'share.error': {
    uz: 'Ma’lumot olinmadi. Internetni tekshirib, qayta urinib ko‘ring.',
    ru: 'Не удалось получить данные. Проверьте интернет и попробуйте снова.',
  },
  'share.ride': { uz: 'Safar №{number}', ru: 'Поездка №{number}' },
  'share.driver': { uz: 'Haydovchi', ru: 'Водитель' },
  'share.car': { uz: 'Mashina', ru: 'Автомобиль' },
  'share.from': { uz: 'Qayerdan', ru: 'Откуда' },
  'share.to': { uz: 'Qayerga', ru: 'Куда' },
  'share.stops': { uz: 'Oraliq manzil', ru: 'Остановки' },
  'share.status.searching': { uz: 'Haydovchi qidirilmoqda', ru: 'Ищем водителя' },
  'share.status.assigned': { uz: 'Haydovchi yo‘lda', ru: 'Водитель едет' },
  'share.status.arrived': { uz: 'Haydovchi yetib keldi', ru: 'Водитель на месте' },
  'share.status.in_progress': { uz: 'Yo‘lda', ru: 'В пути' },
  'share.status.other': { uz: 'Safar davom etmoqda', ru: 'Поездка идёт' },
  'share.noPosition': {
    uz: 'Mashina joylashuvi hozircha yo‘q.',
    ru: 'Положение машины пока недоступно.',
  },
  'share.refresh': { uz: 'Har 5 soniyada yangilanadi', ru: 'Обновляется каждые 5 секунд' },
  'share.sosHint': {
    uz: 'Xavotir bo‘lsa: 112 (favqulodda), operator —',
    ru: 'Если что-то не так: 112 (экстренная служба), оператор —',
  },
  'share.privacy': {
    uz: 'Sahifada telefon raqamlari yo‘q; havola safar tugagach o‘chadi.',
    ru: 'На странице нет номеров телефонов; ссылка перестаёт работать после поездки.',
  },

  // --- legal pages chrome --------------------------------------------------------------
  'legal.privacyTitle': { uz: 'Maxfiylik siyosati', ru: 'Политика конфиденциальности' },
  'legal.termsTitle': { uz: 'Foydalanish shartlari', ru: 'Условия использования' },
  'legal.updated': { uz: 'Tahrir: 2026-yil 16-oktabr', ru: 'Редакция от 16 октября 2026 г.' },
  'legal.placeholderNote': {
    uz: 'Kvadrat qavsdagi joylar ([…]) ro‘yxatdan o‘tgan yuridik shaxs ma’lumotlari bilan to‘ldiriladi.',
    ru: 'Места в квадратных скобках ([…]) заполняются данными зарегистрированного юридического лица.',
  },

  // --- misc ----------------------------------------------------------------------------
  'misc.som': { uz: 'so‘m', ru: 'сум' },
  'misc.km': { uz: 'km', ru: 'км' },
  'misc.notFound': { uz: 'Sahifa topilmadi', ru: 'Страница не найдена' },
} satisfies Record<string, Entry>;

export type Key = keyof typeof dict;

/** `t('prices.upTo', 'ru', { km: 2 })` -> 'до 2 км'. Missing keys return the key itself. */
export function t(key: Key, lang: Lang, vars?: Record<string, string | number>): string {
  const entry = (dict as Record<string, Entry | undefined>)[key];
  let s = entry ? entry[lang] : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** Keys whose values are HTML fragments (filled with innerHTML, never escaped). */
export const isHtmlKey = (key: string) => key.endsWith('_html');
