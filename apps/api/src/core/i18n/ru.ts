/**
 * Russian for every text the API writes for people, keyed by the Uzbek (Latin) text as it
 * stands in the code. A key with `{0}` placeholders is a template: it is looked up by the
 * `key` of `msg()` or matched against a rendered message, and the values carry over.
 * src/core/i18n/catalog.test.ts fails when a message in the code has no entry here.
 *
 * Wording follows what Russian-speaking riders and drivers in Uzbekistan know from taxi
 * apps: заказ, поездка, водитель, пассажир, тариф Эконом/Комфорт/Минивэн/Бизнес, сум.
 */
export const RU: Record<string, string> = {
  // Validation (zod defaults, src/core/http/messages.ts) ---------------------------------
  'Majburiy maydon': 'Обязательное поле',
  'Noto‘g‘ri qiymat turi': 'Неверный тип значения',
  'Kamida {0} ta belgi': 'Минимум символов: {0}',
  'Kamida {0} ta element': 'Минимум элементов: {0}',
  'Kamida {0}': 'Не меньше {0}',
  'Ko‘pi bilan {0} ta belgi': 'Максимум символов: {0}',
  'Ko‘pi bilan {0} ta element': 'Максимум элементов: {0}',
  'Ko‘pi bilan {0}': 'Не больше {0}',
  'Noto‘g‘ri format': 'Неверный формат',
  'Ruxsat etilmagan qiymat': 'Недопустимое значение',
  'Noto‘g‘ri qiymat': 'Неверное значение',
  'Noma’lum maydon': 'Неизвестное поле',
  'Ma’lumotlar noto‘g‘ri': 'Данные заполнены неверно',

  // The exception filter (Postgres errors) and generic HTTP answers ----------------------
  'Ma’lumot shu payt boshqa amal bilan o‘zgardi, qayta urinib ko‘ring':
    'Данные только что изменились другим действием, попробуйте ещё раз',
  'Server hozir band, birozdan so‘ng qayta urinib ko‘ring':
    'Сервер сейчас занят, попробуйте немного позже',
  'Bunday yozuv allaqachon bor': 'Такая запись уже есть',
  'Bog‘langan yozuv topilmadi': 'Связанная запись не найдена',
  'Qiymat qoidaga mos emas': 'Значение не соответствует правилу',
  'Vaqt boshqa yozuv bilan to‘qnashadi': 'Время пересекается с другой записью',
  'Juda ko‘p urinish': 'Слишком много попыток',
  'Tizimga kiring': 'Войдите в систему',
  'Ruxsat yo‘q': 'Нет доступа',
  Topilmadi: 'Не найдено',
  'Noto‘g‘ri so‘rov': 'Неверный запрос',
  'Tizim xatosi': 'Ошибка сервера',
  'Bajarib bo‘lmaydi': 'Действие сейчас невозможно',
  'Qayta urinib ko‘ring': 'Попробуйте ещё раз',

  // Sign-in and the account -------------------------------------------------------------
  'O‘zbekiston raqamini kiriting, masalan +998901234567':
    'Введите узбекский номер, например +998901234567',
  '6 ta raqam': '6 цифр',
  '4 xonali kod': 'Код из 4 цифр',
  'SMS yuborib bo‘lmadi, birozdan so‘ng qayta urinib ko‘ring':
    'Не удалось отправить SMS, попробуйте немного позже',
  'Juda ko‘p noto‘g‘ri kod kiritildi, keyinroq urinib ko‘ring':
    'Слишком много неверных кодов, попробуйте позже',
  'Juda ko‘p noto‘g‘ri urinish, yangi kod so‘rang':
    'Слишком много неверных попыток, запросите новый код',
  'Kod noto‘g‘ri yoki muddati o‘tgan': 'Код неверный или устарел',
  'Yangi kodni bir daqiqadan so‘ng so‘rang': 'Новый код можно запросить через минуту',
  'Hisob bloklangan': 'Аккаунт заблокирован',
  'Siz platforma operatori emassiz': 'Вы не оператор платформы',
  'Faqat platforma operatorlari uchun': 'Только для операторов платформы',
  'O‘zgartirish yo‘q': 'Нечего изменять',
  'Jinsni {0} kunda bir marta o‘zgartirish mumkin': 'Пол можно изменить раз в {0} дней',
  'Expo push token kerak': 'Нужен push-токен Expo',
  'Chipta noto‘g‘ri yoki eskirgan': 'Билет недействителен или устарел',
  'Hodisa topilmadi yoki allaqachon bajarilgan': 'Событие не найдено или уже выполнено',

  // Geography and addresses -------------------------------------------------------------
  'Shahar topilmadi': 'Город не найден',
  'Bunday shahar yo‘q': 'Такого города нет',
  'Manzil topilmadi': 'Адрес не найден',
  'Manzil qidiruvi vaqtincha ishlamayapti': 'Поиск адресов временно недоступен',
  'Bu hududda hozircha ishlamaymiz': 'В этом районе мы пока не работаем',
  'Bunday manzil yo‘q: {0}': 'Такого пункта нет: {0}',
  'Yo‘nalish topilmadi': 'Маршрут не найден',
  'O‘rindiq yoki butun mashina narxi kerak': 'Укажите цену за место или за всю машину',
  'Butun mashina bir o‘rindiqdan arzon bo‘lmaydi':
    'Вся машина не может стоить дешевле одного места',
  'Yo‘nalish bir joyda boshlanib tugamaydi':
    'Маршрут не может начинаться и заканчиваться в одном месте',
  'Halqa yopiq bo‘lishi kerak': 'Контур должен быть замкнут',
  'Ko‘pi bilan {0} ta manzil saqlash mumkin': 'Можно сохранить не больше {0} адресов',
  'key yoki lat va lng yuboring': 'Передайте key или lat и lng',
  'key: GET places/recent dagi qiymat': 'key: значение из GET places/recent',
  'lat va lng birga beriladi': 'lat и lng передаются вместе',

  // Prices and orders -------------------------------------------------------------------
  'Narx topilmadi: qayta hisoblang': 'Цена не найдена: рассчитайте заново',
  'Narx eskirdi: qayta hisoblang': 'Цена устарела: рассчитайте заново',
  'Olib ketish va borish manzillari juda yaqin': 'Точки подачи и назначения слишком близко',
  'Manzillar koordinatasi yoki narx (quoteId) kerak': 'Нужны координаты адресов или цена (quoteId)',
  'Oraliq manzillar koordinatasi yoki narx (quoteId) kerak':
    'Нужны координаты остановок или цена (quoteId)',
  'Oraliq manzillar narxdagidan farq qiladi: qayta hisoblang':
    'Остановки отличаются от рассчитанных: рассчитайте цену заново',
  'Oraliq manzillar {0} tadan ko‘p bo‘lmaydi': 'Остановок не может быть больше {0}',
  'Oraliq manzillar safar boshlangach belgilanadi': 'Остановки отмечаются после начала поездки',
  'Oraliq manzil faqat taksi safarida o‘zgartiriladi':
    'Остановки меняются только в поездке на такси',
  'Karta orqali to‘langan safarda manzillar o‘zgarmaydi: bekor qilib qayta buyurtma bering, pul to‘liq qaytariladi':
    'В поездке, оплаченной картой, адреса не меняются: отмените и закажите заново, деньги вернутся полностью',
  'Bu bosqichda manzillar o‘zgarmaydi': 'На этом этапе адреса не меняются',
  'Mashina yetib borgan oraliq manzil o‘zgarmaydi':
    'Остановку, до которой машина уже доехала, изменить нельзя',
  'Oraliq manzillar o‘zgarmadi': 'Остановки не изменились',
  'Boshqa odam uchun kuniga {0} tadan ko‘p buyurtma berilmaydi':
    'Для другого человека можно заказать не больше {0} поездок в сутки',
  'Bu raqamga bugun allaqachon {0} marta buyurtma berildi':
    'На этот номер сегодня уже заказано {0} раза',
  'Manzillar o‘zgardi: bonus qayta hisoblandi': 'Адреса изменились: бонус пересчитан',
  'Narx o‘zgardi: yangi narxni qayta ko‘rib tasdiqlang':
    'Цена изменилась: посмотрите и подтвердите новую цену',
  'Yangi narx oldindan to‘langan depozitdan kam: bekor qilib qayta buyurtma bering':
    'Новая цена меньше внесённого депозита: отмените и закажите заново',
  'Yuk tashishda oraliq manzil bo‘lmaydi': 'В грузоперевозке остановок нет',
  'Hamroh bilan safarda oraliq manzil bo‘lmaydi': 'В совместной поездке остановок нет',
  'Bunday oraliq manzil yo‘q': 'Такой остановки нет',
  'Bu oraliq manzil ortda qoldi': 'Эта остановка уже позади',
  'Avval oraliq manzilga yetib keling': 'Сначала доедьте до остановки',
  'Avval {0}-oraliq manzildan yo‘lga chiqing': 'Сначала отправьтесь с остановки {0}',
  'Taksi sinfini tanlang: Ekonom, Komfort, Miniven yoki Biznes':
    'Выберите тариф: Эконом, Комфорт, Минивэн или Бизнес',
  '«{0}» sinfi hozircha ishlamaydi: boshqa sinfni tanlang':
    'Тариф «{0}» пока недоступен: выберите другой',
  'Hamroh bilan safar faqat Ekonom va Komfort sinflarida':
    'Совместная поездка доступна только в тарифах Эконом и Комфорт',
  'Hamroh bilan safar hozircha o‘chirilgan': 'Совместные поездки пока отключены',
  'Hamroh bilan safar hozircha faqat naqd to‘lov bilan':
    'Совместная поездка пока только за наличные',
  'Bu yo‘nalishda o‘rindiq narxi belgilanmagan': 'На этом маршруте нет цены за место',
  'Ayol haydovchi tanlovi ayollar uchun: profilingizda jinsingizni belgilang':
    'Опция «Женщина-водитель» доступна женщинам: укажите пол в профиле',
  'Bu xizmatda yo‘lovchilar soni tanlanmaydi': 'В этой услуге число пассажиров не выбирается',
  'Minivenda {0} tadan ortiq yo‘lovchi bo‘lmaydi': 'В минивэне не больше {0} пассажиров',
  'Bir mashinada {0} tadan ortiq yo‘lovchi bo‘lmaydi (oldinda 1, orqada 2): ko‘p kishi uchun Minivenni tanlang':
    'В одной машине не больше {0} пассажиров (1 спереди, 2 сзади): для большей компании выберите Минивэн',
  'Mashinada {0} tadan ortiq yo‘lovchi bo‘lmaydi (oldinda 1, orqada 2)':
    'В машине не больше {0} пассажиров (1 спереди, 2 сзади)',
  'Promokod va bonus hozir buyurtma qilinadigan, hamrohsiz safarlarga qo‘llanadi':
    'Промокод и бонус применяются к поездкам «сейчас» без попутчиков',
  'Oldindan buyurtma {0} daqiqadan {1} soatgacha oldin beriladi':
    'Предзаказ оформляется от {0} минут до {1} часов заранее',
  'Oldindan buyurtma hozircha faqat naqd to‘lov bilan': 'Предзаказ пока только за наличные',
  'Oldindan {0} tadan ortiq buyurtma berib bo‘lmaydi': 'Нельзя оформить больше {0} предзаказов',
  'Tugallanmagan buyurtma bor: #{0}': 'У вас есть незавершённый заказ: #{0}',
  'Bu mijoz bloklangan': 'Этот клиент заблокирован',
  'Telefon orqali hozircha faqat taksi buyurtma qilinadi':
    'По телефону пока можно заказать только такси',
  'Boshqa odam uchun buyurtma faqat taksi uchun':
    'Заказ для другого человека доступен только для такси',
  'Bu sizning raqamingiz: o‘zingiz uchun buyurtmada yo‘lovchini ko‘rsatmang':
    'Это ваш номер: для поездки на себя пассажира указывать не нужно',
  'Qabul qiluvchining ismi va telefon raqamini kiriting': 'Укажите имя и телефон получателя',
  'Yetkazib berish hozircha ishlamaydi': 'Доставка пока недоступна',
  'Yetkazib berish uchun taksi sinfini tanlang': 'Для доставки выберите тариф такси',
  'Posilka {0} kg dan og‘ir bo‘lmasligi kerak: og‘irroq yuk uchun «Yuk tashish»':
    'Посылка не тяжелее {0} кг: для груза потяжелее — «Грузоперевозка»',
  'Posilka boshqa yo‘lovchilar bilan birga yuborilmaydi':
    'Посылка не отправляется вместе с другими пассажирами',
  'Yuk tashish hozircha ishlamaydi': 'Грузоперевозки пока недоступны',
  'Yuk tashishda hamroh, o‘rindiq va ayol haydovchi tanlovlari yo‘q':
    'В грузоперевозке нет попутчиков, мест и выбора женщины-водителя',
  'Yuk mashinasi turini tanlang: cargo_s yoki cargo_m':
    'Выберите тип грузовой машины: cargo_s или cargo_m',
  'Bu mashina {0} kg gacha yuk oladi: kattaroq mashina tanlang':
    'Эта машина берёт до {0} кг: выберите машину побольше',
  'Yukchilar {0} tadan ko‘p bo‘lmaydi': 'Грузчиков не больше {0}',
  'Buyurtma topilmadi': 'Заказ не найден',
  'Sizda bunday faol buyurtma yo‘q': 'У вас нет такого активного заказа',
  'Bu bosqichda buyurtmani bekor qilib bo‘lmaydi': 'На этом этапе заказ отменить нельзя',
  'Bu buyurtma endi yo‘lingizda emas': 'Этот заказ больше не по пути',
  'Bu buyurtma endi yo‘lingizda emas yoki mashinada joy yo‘q':
    'Этот заказ больше не по пути или в машине нет места',
  'Buyurtma allaqachon yakunlangan': 'Заказ уже завершён',
  'Buyurtma holati mos emas: {0}': 'Статус заказа не подходит: {0}',
  'Safar boshlangan: muammo bo‘lsa operatorga murojaat qiling':
    'Поездка началась: при проблемах обратитесь к оператору',
  'Safar yakunlangan': 'Поездка завершена',
  'Yo‘lovchini kamida {0} daqiqa kuting': 'Подождите пассажира не меньше {0} минут',
  'Yo‘lovchidan 4 xonali kodni so‘rang': 'Спросите у пассажира 4-значный код',
  'Kod noto‘g‘ri: yo‘lovchidan 4 xonali kodni so‘rang':
    'Код неверный: спросите у пассажира 4-значный код',
  'Kod ko‘p marta noto‘g‘ri kiritildi. 15 daqiqadan keyin qayta urinib ko‘ring yoki operatorga qo‘ng‘iroq qiling':
    'Код много раз введён неверно. Попробуйте через 15 минут или позвоните оператору',
  'Bu safar uchun qarz yo‘q (to‘langan yoki kechirilgan)':
    'По этой поездке долга нет (оплачен или прощён)',
  'To‘lov allaqachon olingan': 'Оплата уже получена',
  'Oldingi bekor qilingan safar uchun to‘lov': 'Плата за ранее отменённую поездку',
  'Haydovchi topilmadi': 'Водитель не найден',
  'Bo‘sh mashina topilmadi': 'Свободных машин не нашлось',
  'To‘lov vaqtida amalga oshirilmadi': 'Оплата не прошла вовремя',
  'Yo‘lovchi boshqa safarda': 'Пассажир в другой поездке',

  // Dispatch and the driver's side of a ride --------------------------------------------
  'Taklif topilmadi': 'Предложение не найдено',
  'Taklif endi amal qilmaydi': 'Предложение уже недействительно',
  'Buyurtma boshqa haydovchiga berildi': 'Заказ передан другому водителю',
  'Avval liniyaga chiqing': 'Сначала выйдите на линию',
  'Buyurtma allaqachon boshqa haydovchiga berilgan': 'Заказ уже передан другому водителю',
  'Bu haydovchi allaqachon tayinlangan': 'Этот водитель уже назначен',
  'Haydovchi faol emas': 'Водитель неактивен',
  'Bu haydovchining mashinasi bu yukka mos emas':
    'Машина этого водителя не подходит для этого груза',
  'Yuk mashinasi yo‘lovchi va posilka buyurtmalarini olmaydi':
    'Грузовая машина не берёт заказы с пассажирами и посылками',
  'Bu mashina «{0}» buyurtmasiga mos emas': 'Эта машина не подходит для заказа «{0}»',
  'O‘zingizning buyurtmangizni ololmaysiz': 'Нельзя взять собственный заказ',
  'Haydovchida faol buyurtma bor: #{0}': 'У водителя есть активный заказ: #{0}',
  'Hisobingiz faol emas: buyurtma boshqa haydovchiga beriladi':
    'Ваш аккаунт неактивен: заказ будет передан другому водителю',

  // Drivers: application, status, car, documents ----------------------------------------
  'Siz haydovchi sifatida ro‘yxatdan o‘tmagansiz': 'Вы не зарегистрированы как водитель',
  'Arizangiz allaqachon ko‘rib chiqilgan: o‘zgartirish uchun operatorga murojaat qiling':
    'Ваша заявка уже рассмотрена: для изменений обратитесь к оператору',
  'Hujjat muddati o‘tgan': 'Срок документа истёк',
  'Hujjat muddati o‘tgan: {0}': 'Срок документа истёк: {0}',
  'Hujjatlar yetishmaydi: {0}': 'Не хватает документов: {0}',
  'Hujjatlar to‘liq yuklanmagan': 'Загружены не все документы',
  'Avtomobil ma’lumotlari yo‘q': 'Нет данных об автомобиле',
  'Avtomobil topilmadi': 'Автомобиль не найден',
  'Litsenziya kartochkasi muddati o‘tgan': 'Срок лицензионной карточки истёк',
  'Litsenziya kartochkasi muddati o‘tgan: yangisini yuklang':
    'Срок лицензионной карточки истёк: загрузите новую',
  'Litsenziya kartochkasi tasdiqlanmagan: operatorga murojaat qiling':
    'Лицензионная карточка не подтверждена: обратитесь к оператору',
  'Litsenziya kartochkasi tekshirilmoqda': 'Лицензионная карточка проверяется',
  'Litsenziya kartochkasi tasdiqlanmadi': 'Лицензионная карточка не подтверждена',
  'Balans juda past': 'Баланс слишком низкий',
  'Balans juda past: liniyaga chiqish uchun balansni to‘ldiring':
    'Баланс слишком низкий: пополните его, чтобы выйти на линию',
  'Hisobingiz faol emas': 'Ваш аккаунт неактивен',
  'Hisobingiz bloklangan': 'Ваш аккаунт заблокирован',
  'Hisobingiz bloklangan: {0}': 'Ваш аккаунт заблокирован: {0}',
  'Hisobingiz bloklangan: operatorga murojaat qiling':
    'Ваш аккаунт заблокирован: обратитесь к оператору',
  'Arizangiz operator tomonidan ko‘rib chiqilmoqda': 'Ваша заявка на рассмотрении у оператора',
  'Ariza rad etildi': 'Заявка отклонена',
  'Ariza rad etildi: {0}': 'Заявка отклонена: {0}',
  Faol: 'Активен',
  'Mashinada yo‘lovchi bo‘lsa, qayerga ketayotganingizni belgilang':
    'Если в машине пассажир, укажите, куда вы едете',
  'Bu imkoniyat jinsi operator tomonidan tasdiqlangan ayol haydovchilar uchun':
    'Эта возможность только для женщин-водителей, чей пол подтвердил оператор',
  'Bu sinfdan pastroq sinf yo‘q': 'Ниже этого тарифа ничего нет',
  'Bu taksi avtomobili: yuk sinfi berilmaydi': 'Это легковое такси: грузовой класс не назначается',
  'Bu amal "{0}" holatidagi haydovchiga qo‘llanmaydi':
    'Действие неприменимо к водителю в статусе «{0}»',
  'Sababini yozing': 'Укажите причину',
  'Faqat rad etilgan yoki bloklangan hisob uchun murojaat qilinadi':
    'Обжаловать можно только отклонённую заявку или блокировку',
  'Murojaatingiz ko‘rib chiqilmoqda': 'Ваше обращение рассматривается',
  'Ochiq murojaat topilmadi': 'Открытое обращение не найдено',
  'Davlat raqami noto‘g‘ri, masalan 20 A 123 BC yoki 20 123 ABC':
    'Неверный госномер, например 20 A 123 BC или 20 123 ABC',
  'Guvohnoma raqami noto‘g‘ri, masalan AF1234567': 'Неверный номер прав, например AF1234567',
  'Litsenziya kartochkasi raqami noto‘g‘ri': 'Неверный номер лицензионной карточки',
  'JShShIR 14 ta raqamdan iborat': 'ПИНФЛ состоит из 14 цифр',
  'Sana YYYY-MM-DD ko‘rinishida': 'Дата в формате ГГГГ-ММ-ДД',
  'Joylashuv aniqligi past': 'Низкая точность геолокации',
  'Joylashuv xizmat hududidan juda uzoqda': 'Геолокация слишком далеко от зоны обслуживания',
  'Joylashuv keskin o‘zgardi, qayta aniqlanmoqda': 'Геолокация резко изменилась, определяем заново',
  // the car rules (src/lib/driver-rules.ts)
  'Haydovchi kamida {0} yoshda bo‘lishi kerak': 'Водителю должно быть не меньше {0} лет',
  'Haydovchilik staji kamida {0} yil bo‘lishi kerak': 'Водительский стаж не меньше {0} лет',
  'B toifali guvohnoma kerak': 'Нужны права категории B',
  'Furgon turidagi avtomobillar taksi bo‘la olmaydi': 'Фургоны не могут работать в такси',
  'Yuk kuzovli avtomobil taksi bo‘la olmaydi: yuk tashish uchun ariza bering':
    'Грузовой автомобиль не может работать в такси: подайте заявку на грузоперевозки',
  'Avtomobil {0} yildan eski bo‘lmasligi kerak': 'Автомобиль не старше {0} лет',
  'Miniven uchun haydovchidan tashqari {0}–{1} o‘rindiq kerak':
    'Для Минивэна нужно {0}–{1} пассажирских мест',
  'Yo‘lovchi o‘rindiqlari {0} tadan ko‘p bo‘lmasligi kerak': 'Пассажирских мест не больше {0}',
  '{0} uchun avtomobil {1} yildan eski bo‘lmasligi kerak':
    'Для тарифа {0} автомобиль не старше {1} лет',
  '{0} uchun konditsioner kerak': 'Для тарифа {0} нужен кондиционер',
  'Biznes uchun premium avtomobil kerak (Malibu, Tracker Premier, K5, Sonata va h.k.)':
    'Для Бизнеса нужен автомобиль премиум-класса (Malibu, Tracker Premier, K5, Sonata и т. п.)',
  'Biznes uchun sedan yoki krossover kerak': 'Для Бизнеса нужен седан или кроссовер',
  'Biznes uchun haydovchi reytingi kamida {0} bo‘lishi kerak':
    'Для Бизнеса рейтинг водителя не ниже {0}',
  'Yuk mashinasi furgon, pikap yoki yuk kuzovli bo‘lishi kerak':
    'Грузовая машина должна быть фургоном, пикапом или с грузовым кузовом',
  'Yuk ko‘tarish quvvatini kiriting (kg)': 'Укажите грузоподъёмность (кг)',
  'Yuk mashinasi {0} yildan eski bo‘lmasligi kerak': 'Грузовая машина не старше {0} лет',
  'Kabinada haydovchidan tashqari 1 yoki {0} o‘rin bo‘ladi':
    'В кабине 1 или {0} места кроме водителя',
  '3,5 tonnadan og‘ir mashina uchun C toifali guvohnoma kerak':
    'Для машины тяжелее 3,5 т нужны права категории C',
  'To‘liq massa yuk ko‘tarish quvvatidan katta bo‘lishi kerak':
    'Полная масса должна быть больше грузоподъёмности',
  // what a car needs for each class (GET driver/config)
  '{0} yildan eski bo‘lmagan, {1} tagacha o‘rindiq': 'Не старше {0} лет, до {1} мест',
  '{0} yildan eski bo‘lmagan, konditsionerli': 'Не старше {0} лет, с кондиционером',
  '{0}–{1} o‘rindiq, {2} yildan eski bo‘lmagan, konditsionerli':
    '{0}–{1} мест, не старше {2} лет, с кондиционером',
  'Premium model, {0} yildan eski bo‘lmagan, konditsionerli, reyting {1}+':
    'Премиум-модель не старше {0} лет, с кондиционером, рейтинг {1}+',

  // Classes (src/lib/ride-classes.ts) ------------------------------------------------------
  Ekonom: 'Эконом',
  Komfort: 'Комфорт',
  Miniven: 'Минивэн',
  Biznes: 'Бизнес',
  'Arzon va tez: oddiy sedan': 'Недорого и быстро: обычный седан',
  'Yangiroq mashina, konditsioner': 'Машина поновее, кондиционер',
  '6 kishigacha va katta yuk': 'До 6 человек и крупный багаж',
  'Premium mashina, tajribali haydovchi': 'Премиум-автомобиль, опытный водитель',
  'Kichik yuk mashinasi': 'Малый грузовик',
  'O‘rta yuk mashinasi': 'Средний грузовик',
  'Ekonom sinfini o‘chirib bo‘lmaydi': 'Тариф Эконом нельзя отключить',

  // Reasons (src/lib/reasons.ts) ---------------------------------------------------------
  'Juda uzoq': 'Слишком далеко',
  'Bu tomonga bormayman': 'Не еду в эту сторону',
  'Yo‘lovchi reytingi past': 'Низкий рейтинг пассажира',
  'Avtomobil mos emas': 'Машина не подходит',
  'Dam olyapman': 'Отдыхаю',
  'Boshqa sabab': 'Другая причина',
  'Yo‘lovchi chiqmadi': 'Пассажир не вышел',
  'Avtomobil nosoz': 'Поломка автомобиля',
  'Manzilga yetib borolmayman': 'Не могу доехать до адреса',
  'Yo‘lovchi bekor qilishni so‘radi': 'Пассажир попросил отменить',
  'Operator boshqa haydovchiga berdi': 'Оператор передал другому водителю',

  // Chat (src/lib/chat.ts) ---------------------------------------------------------------
  Chiqyapman: 'Выхожу',
  '5 daqiqada chiqaman': 'Выйду через 5 минут',
  'Qayerdasiz?': 'Где вы?',
  'Podyezd oldidaman': 'Я у подъезда',
  'Iltimos, biroz kuting': 'Пожалуйста, подождите немного',
  'Menga qo‘ng‘iroq qiling': 'Позвоните мне',
  'Yetib keldim': 'Я на месте',
  'Yo‘ldaman, tez orada yetib boraman': 'Уже еду, скоро буду',
  'Tirbandlik, biroz kechikaman': 'Пробка, немного задержусь',
  'Manzilni topa olmayapman, mo‘ljalni yozing': 'Не могу найти адрес, напишите ориентир',
  'Suhbat yopiq: safar tugagan yoki haydovchi hali yo‘q':
    'Чат закрыт: поездка завершена или водитель ещё не назначен',
  'Bu safar uchun xabarlar chegarasiga yetildi': 'Достигнут лимит сообщений для этой поездки',
  'Bunday tezkor javob yo‘q': 'Такого быстрого ответа нет',
  'Xabar bo‘sh': 'Сообщение пустое',
  'Xabar {0} belgidan oshmasin': 'Сообщение не длиннее {0} символов',
  'Matn yoki tezkor javobdan bittasini yuboring': 'Отправьте либо текст, либо быстрый ответ',

  // Ratings, safety, complaints -------------------------------------------------------
  'Faqat yakunlangan safarni baholash mumkin': 'Оценить можно только завершённую поездку',
  'Baholash muddati o‘tgan': 'Время для оценки истекло',
  'Siz bu safarni allaqachon baholagansiz': 'Вы уже оценили эту поездку',
  'Safar allaqachon yakunlangan: 112 raqamiga qo‘ng‘iroq qiling':
    'Поездка уже завершена: позвоните по номеру 112',
  'Ochiq SOS topilmadi': 'Открытый сигнал SOS не найден',
  'Havola topilmadi': 'Ссылка не найдена',
  'Havola noto‘g‘ri': 'Неверная ссылка',
  'Mashinada narsa qoldi': 'Забыл(а) вещь в машине',
  'Haydovchining xulqi': 'Поведение водителя',
  'Yo‘l / manzil': 'Маршрут / адрес',
  Narx: 'Цена',
  'Mashina holati': 'Состояние машины',
  Xavfsizlik: 'Безопасность',
  Boshqa: 'Другое',
  'Murojaat safardan keyin {0} kun ichida qabul qilinadi':
    'Обращение принимается в течение {0} дней после поездки',
  'Bu masala bo‘yicha murojaatingiz ko‘rib chiqilmoqda':
    'Ваше обращение по этому вопросу уже рассматривается',
  'Murojaat topilmadi': 'Обращение не найдено',
  'Murojaat yopilgan': 'Обращение закрыто',
  'Murojaat allaqachon yopilgan': 'Обращение уже закрыто',
  'Ko‘pi bilan {0} ta rasm': 'Не больше {0} фото',
  'Bitta murojaatga ko‘pi bilan {0} ta rasm qo‘shiladi':
    'К одному обращению можно приложить не больше {0} фото',

  // Uploads ---------------------------------------------------------------------------
  'Bu turdagi fayl uchun faqat JPEG, PNG yoki WebP rasm mumkin':
    'Для этого типа подходит только изображение JPEG, PNG или WebP',
  'Fayl hajmi {0} MB dan oshmasin': 'Размер файла не больше {0} МБ',
  'Fayl hajmi 10 MB dan oshmasin': 'Размер файла не больше 10 МБ',
  'Fayl topilmadi': 'Файл не найден',
  'Fayl hali yuklanmagan': 'Файл ещё не загружен',
  'Fayl buzilgan yoki e’lon qilingan turga mos emas: JPEG, PNG, WebP yoki PDF yuklang':
    'Файл повреждён или не соответствует заявленному типу: загрузите JPEG, PNG, WebP или PDF',
  'Fayl yuklanishi tugallanmagan': 'Загрузка файла не завершена',
  'Bu fayl boshqa maqsad uchun yuklangan': 'Этот файл загружен для другой цели',
  'Fayl yuklash serverda hali sozlanmagan': 'Загрузка файлов на сервере ещё не настроена',
  'uploadId yoki url dan bittasini yuboring': 'Передайте либо uploadId, либо url',

  // Money: balance, top-ups, card payments, receipts ----------------------------------
  'Balansda {0} so‘m bor: undan ko‘p to‘lab bo‘lmaydi': 'На балансе {0} сум: больше списать нельзя',
  'Balansda mablag‘ yetarli emas: {0} so‘m kerak, {1} so‘m bor':
    'На балансе недостаточно средств: нужно {0} сум, есть {1} сум',
  'To‘ldirish summasi musbat bo‘lishi kerak': 'Сумма пополнения должна быть положительной',
  'To‘ldirish summasi {0} dan {1} so‘mgacha bo‘lishi kerak': 'Сумма пополнения от {0} до {1} сум',
  'To‘lov summasini musbat son bilan va izoh (karta/hisob, o‘tkazma raqami) bilan yozing':
    'Укажите положительную сумму и примечание (карта/счёт, номер перевода)',
  'Tuzatish uchun izoh yozing': 'Для корректировки укажите примечание',
  'Xuddi shunday yozuv hozirgina qo‘shildi: takrorlanmadimi?':
    'Точно такая же запись только что добавлена: не повтор ли это?',
  'Summa 0 bo‘lmasligi kerak': 'Сумма не может быть 0',
  'Kamida {0} so‘m': 'Не меньше {0} сум',
  'Ko‘pi bilan {0} so‘m': 'Не больше {0} сум',
  'Karta orqali to‘lov hali ulanmagan: naqd to‘lang':
    'Оплата картой ещё не подключена: оплатите наличными',
  'Karta orqali to‘lov hali ulanmagan: ofisda naqd to‘ldiring':
    'Оплата картой ещё не подключена: пополните наличными в офисе',
  'To‘lov topilmadi': 'Платёж не найден',
  'To‘lov kutilmayapti': 'Платёж не ожидается',
  'Bu to‘lov qaytarish kutmayapti': 'Этот платёж не ожидает возврата',
  'Bu to‘lov bo‘yicha boshqa tranzaksiya kutilmoqda':
    'По этому платежу уже ожидается другая транзакция',
  'Noto‘g‘ri summa': 'Неверная сумма',
  'Tranzaksiya topilmadi': 'Транзакция не найдена',
  'Metod topilmadi': 'Метод не найден',
  'Bekor qilib bo‘lmaydi': 'Отменить нельзя',
  'Chek topilmadi': 'Чек не найден',
  'Chek allaqachon yuborilgan': 'Чек уже отправлен',
  'Chek uchun yakunlangan safar topilmadi': 'Завершённая поездка для чека не найдена',

  // Tips ------------------------------------------------------------------------------
  'Choychaqa hozircha o‘chirilgan': 'Чаевые пока отключены',
  'Choychaqa kamida {0}': 'Чаевые не меньше {0}',
  'Choychaqa ko‘pi bilan {0}': 'Чаевые не больше {0}',
  'Summani 100 so‘mga karrali yozing': 'Укажите сумму, кратную 100 сум',
  'Choychaqa safardan keyin faqat bir kun ichida beriladi':
    'Чаевые можно оставить только в течение суток после поездки',
  'Choychaqa safar yakunlangandan keyin beriladi': 'Чаевые можно оставить после завершения поездки',
  'Bu safar uchun choychaqa allaqachon berilgan': 'Чаевые за эту поездку уже оставлены',
  'Karta orqali choychaqa hozircha ishlamaydi: naqd bering':
    'Чаевые картой пока недоступны: оставьте наличными',

  // Promo codes and referrals -----------------------------------------------------------
  'Promokod topilmadi': 'Промокод не найден',
  'Bunday promokod topilmadi': 'Такой промокод не найден',
  'Promokod topilmadi: uni qayta kiriting': 'Промокод не найден: введите его заново',
  'Bunday promokod allaqachon bor': 'Такой промокод уже есть',
  'Promokod 3–20 ta harf va raqamdan iborat bo‘ladi': 'Промокод состоит из 3–20 букв и цифр',
  'Kod 3–20 ta lotin harfi va raqamdan iborat bo‘ladi': 'Код состоит из 3–20 латинских букв и цифр',
  'Promokod «{0}» uchun emas': 'Промокод не действует для услуги «{0}»',
  'Promokod «{0}» sinfi uchun emas': 'Промокод не действует для тарифа «{0}»',
  'Promokod {0}dan qimmat safarlar uchun': 'Промокод для поездок дороже {0}',
  Taksi: 'Такси',
  'Yuk tashish': 'Грузоперевозка',
  'Yetkazib berish': 'Доставка',
  'Bu promokod faol emas': 'Этот промокод не активен',
  'Promokod {0} dan amal qiladi': 'Промокод действует с {0}',
  'Promokod muddati tugagan': 'Срок промокода истёк',
  'Promokodning limiti tugagan': 'Лимит промокода исчерпан',
  'Siz bu promokoddan foydalanib bo‘lgansiz': 'Вы уже использовали этот промокод',
  'Bu promokod faqat birinchi safar uchun': 'Этот промокод только для первой поездки',
  'Promokod bu shaharda amal qilmaydi': 'Промокод не действует в этом городе',
  'Taklif dasturi hozircha to‘xtatilgan': 'Программа приглашений пока приостановлена',
  'O‘zingizning taklif kodingizni kiritib bo‘lmaydi': 'Нельзя ввести собственный код приглашения',
  'Siz taklif kodini allaqachon kiritgansiz': 'Вы уже ввели код приглашения',
  'Taklif kodi faqat birinchi safargacha kiritiladi': 'Код приглашения вводится до первой поездки',
  'Bu taklif kodi amal qilmaydi': 'Этот код приглашения недействителен',
  'Bu qurilmadan taklif kodi allaqachon kiritilgan':
    'С этого устройства код приглашения уже вводили',
  'O‘z kodingizni boshqa raqamdan kiritib bo‘lmaydi': 'Нельзя ввести свой код с другого номера',
  'Bu kod yo‘lovchining taklif kodi: boshqasini tanlang':
    'Это код приглашения пассажира: выберите другой',
  'Taklif chegirmasi ishlatib bo‘lingan': 'Скидка по приглашению уже использована',
  'Taklif allaqachon bekor qilingan': 'Приглашение уже отменено',
  'Do‘st taklifi: {0}% chegirma ({1}gacha)': 'По приглашению друга: скидка {0}% (до {1})',
  'Noto‘g‘ri kod ko‘p marta kiritildi. Bir soatdan keyin qayta urinib ko‘ring':
    'Неверный код введён слишком много раз. Попробуйте через час',
  'Qurilma identifikatori noto‘g‘ri': 'Неверный идентификатор устройства',
  'Sinf nomi noto‘g‘ri': 'Неверное имя тарифа',
  'Foiz 1 dan 100 gacha bo‘ladi': 'Процент от 1 до 100',
  'Foizli promokodga eng ko‘p chegirma summasini yozing':
    'Для процентного промокода укажите максимальную сумму скидки',
  'Tugash sanasi boshlanishidan keyin bo‘lishi kerak':
    'Дата окончания должна быть позже даты начала',
  'SFF Taxi — Guliston taksisi, narx oldindan ma’lum. Mening kodim {0} bilan {1}: {2}':
    'SFF Taxi — такси Гулистана, цена известна заранее. По моему коду {0} — {1}: {2}',
  'birinchi safaringizga {0}% chegirma ({1}gacha)': 'скидка {0}% на первую поездку (до {1})',
  'sovg‘a': 'подарок',

  // The intercity trip board ------------------------------------------------------------
  'Faqat tasdiqlangan haydovchi qatnov e’lon qiladi':
    'Публиковать рейсы может только подтверждённый водитель',
  'Yuk mashinasida yo‘lovchi qatnovi e’lon qilinmaydi':
    'На грузовой машине пассажирский рейс не публикуется',
  'Qatnov kuni litsenziya kartochkasi amal qilmaydi':
    'В день рейса лицензионная карточка недействительна',
  'Balans juda past: qatnov e’lon qilish uchun to‘ldiring':
    'Баланс слишком низкий: пополните его, чтобы опубликовать рейс',
  'Avtomobilda {0} ta yo‘lovchi o‘rni bor': 'В автомобиле {0} пассажирских мест',
  'Jo‘nash vaqti kamida {0} daqiqadan keyin bo‘lsin':
    'Время отправления не раньше чем через {0} минут',
  'Qatnovni {0} kundan uzoqqa e’lon qilib bo‘lmaydi':
    'Рейс нельзя опубликовать дальше чем на {0} дней',
  'Narx {0}–{1} so‘m oralig‘ida, 100 so‘mga karrali bo‘lsin':
    'Цена в пределах {0}–{1} сум, кратная 100',
  'Jo‘nash va borish shahri bir xil': 'Город отправления и назначения совпадают',
  'Shu vaqtga yaqin qatnovingiz bor: #{0}': 'У вас уже есть рейс на близкое время: #{0}',
  'Mashinaga ko‘pi bilan 3 yo‘lovchi olinadi: oldinda 1, orqada 2':
    'В машину не больше 3 пассажиров: 1 спереди, 2 сзади',
  'Orqa o‘rindiqqa 2 tadan ortiq yo‘lovchi olinmaydi': 'На заднее сиденье не больше 2 пассажиров',
  'Bir mashinaga ko‘pi bilan 3 yo‘lovchi: oldinda 1, orqada 2 kishi':
    'В одну машину не больше 3 пассажиров: 1 спереди, 2 сзади',
  'Yo‘lovchilarni jo‘nashdan {0} daqiqa oldin yig‘ish mumkin':
    'Сбор пассажиров возможен за {0} минут до отправления',
  'Hech kim o‘tirmagan: yo‘lovchini belgilang yoki bekor qiling':
    'Никто не сел: отметьте пассажира или отмените',
  'Bu bron faol emas': 'Эта бронь не активна',
  'Bron topilmadi': 'Бронь не найдена',
  'Bu bronni bekor qilib bo‘lmaydi': 'Эту бронь отменить нельзя',
  'Mashina jo‘nab ketgan': 'Машина уже уехала',
  'Qatnov topilmadi': 'Рейс не найден',
  'Qatnov holati mos emas: {0}': 'Статус рейса не подходит: {0}',
  'Bu qatnovga bron yopilgan': 'Бронирование на этот рейс закрыто',
  'O‘z qatnovingizga joy band qilolmaysiz': 'Нельзя забронировать место в собственном рейсе',
  'Faqat {0} ta joy qoldi': 'Осталось мест: {0}',
  'Bo‘sh joy qolmadi': 'Свободных мест не осталось',
  'Old o‘rindiq band yoki taklif qilinmagan': 'Переднее место занято или не предлагается',
  'Old o‘rindiq orqadagidan arzon bo‘lmasin': 'Переднее место не может быть дешевле заднего',
  'Bu qatnovda broningiz bor: #{0}': 'У вас уже есть бронь на этот рейс: #{0}',
  'Bu qatnov {0} → {1} yo‘lidan o‘tmaydi': 'Этот рейс не проходит по маршруту {0} → {1}',
  'Oldindan bron uchun karta orqali to‘lov hali ulanmagan':
    'Оплата картой для предварительной брони ещё не подключена',
  'Qatnovga bron bor: o‘zgartirib bo‘lmaydi (bekor qilish mumkin)':
    'На рейс есть брони: изменить нельзя (можно отменить)',
  'Hisobingiz faol emas: qatnovni operator bilan hal qiling':
    'Ваш аккаунт неактивен: решите вопрос с рейсом через оператора',
  'O‘zgartirish uchun kamida bitta maydon yuboring': 'Для изменения передайте хотя бы одно поле',
  'Oldindan to‘lov qilinmadi': 'Предоплата не внесена',
  'Oldindan to‘lov vaqtida qilinmadi': 'Предоплата не внесена вовремя',

  // Operator settings (validated when operators save them) -------------------------------
  '17 ta raqam': '17 цифр',
  raqamlar: 'только цифры',
  'Efir radiusi qidiruv radiusidan katta bo‘lmasligi kerak':
    'Радиус эфира не больше радиуса поиска',
  'Chegirma foizi bo‘lsa, eng ko‘p summa ham bo‘lishi kerak':
    'Если задан процент скидки, нужна и максимальная сумма',
  'Eng kam summa eng ko‘pidan katta bo‘lmasin': 'Минимальная сумма не больше максимальной',
  'Tugmalar eng kam va eng ko‘p summa orasida bo‘lsin':
    'Кнопки должны быть между минимальной и максимальной суммой',
};
