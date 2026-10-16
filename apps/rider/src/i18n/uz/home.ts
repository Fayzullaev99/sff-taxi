/** Texts of the home screens (Uzbek Latin, the source language). */
export const home = {
  addressLookingUp: 'Manzil aniqlanmoqda…',
  pinnedPlace: 'Pin qo‘yilgan joy',
  awaitingPayment: 'To‘lov kutilmoqda',
  activeRide: 'Faol safaringiz bor',
  scheduledA11y: 'Oldindan buyurtmalar: {count} ta. Eng yaqini {when}',
  locating: 'Joylashuv aniqlanmoqda',
  myLocation: 'Mening joylashuvim',
  greeting: 'Salom, {name}!',
  whereToGo: 'Qayerga boramiz?',
  fromA11y: 'Qayerdan: {address}. O‘zgartirish',
  fromCaption: 'QAYERDAN',
  vagueLocation: 'Joylashuv taxminiy (±{metres} m) — pinni aniq joyga suring',
  mapA11y: 'Xarita. Olib ketish joyini tanlash uchun xaritani suring.',
  whereTo: {
    taxi: 'Qayerga?',
    cargo: 'Yukni qayerga?',
    delivery: 'Posilkani qayerga?',
  },
  saved: {
    home: {
      label: 'Uy',
      add: 'Uy qo‘shish',
      go: 'Uyga borish: {address}',
      addAddress: 'Uy manzilini qo‘shish',
    },
    work: {
      label: 'Ish',
      add: 'Ish qo‘shish',
      go: 'Ishga borish: {address}',
      addAddress: 'Ish manzilini qo‘shish',
    },
  },
  goAgain: 'Yana borish: {place}',
  fixedFare: 'Belgilangan narx: {route}',
  intercityA11y: 'Shaharlararo qatnovlar: joy band qilish',
  points: {
    pickup: 'Olib ketish joyi',
    dropoff: 'Borish manzili',
  },
  search: {
    fromTitle: 'Qayerdan?',
    stopTitle: '{n}-oraliq manzil',
    pickupPlaceholder: 'Qayerdan olib ketamiz?',
    placeholder: 'Ko‘cha, mahalla yoki joy nomi',
    inputA11y: 'Manzilni qidirish',
    clear: 'Tozalash',
    locatingShort: 'Aniqlanmoqda…',
    myLocationHint: 'GPS bo‘yicha, aniq joy',
    placesFailed: 'Saqlangan va oxirgi manzillar yuklanmadi',
    tapToRetry: 'Qayta urinish uchun bosing',
    onMap: 'Xaritada belgilash',
    onMapHint: 'Pinni kerakli joyga qo‘ying',
    pickPlace: 'Joyni belgilash',
    pickPlaceHint: 'Joylashuvingiz yoki koordinatalar',
    noGeocoder: 'Manzil qidiruvi hozircha ishlamayapti — joyni xaritada belgilang.',
    recentSection: 'OXIRGI MANZILLAR',
    nothingFound: 'Hech narsa topilmadi. Boshqacha yozib ko‘ring yoki joyni xaritada belgilang.',
    notServiceable: 'bu yerdan hozircha olib ketmaymiz',
    hideHint: 'Yashirish uchun bosib turing',
    hide: {
      title: 'Manzilni yashirish',
      message:
        '«{place}» oxirgi manzillardan olib tashlanadi. Safarlar tarixi o‘zgarmaydi; shu yerga yana borsangiz, ro‘yxatda qayta paydo bo‘ladi.',
      confirm: 'Yashirish',
    },
  },
  pickOnMap: {
    stopCaption: 'ORALIQ MANZIL',
    toCaption: 'QAYERGA',
  },
  mapless: {
    title: 'Xarita bu qurilmada ko‘rsatilmaydi',
    homeHint:
      'Olib ketish joyini «Mening joylashuvim» tugmasi yoki «Qayerdan» qatoridagi qidiruv bilan belgilang.',
    pickerHint:
      'Xarita bu qurilmada ko‘rsatilmaydi: joylashuvingizni aniqlang yoki koordinatalarni kiriting.',
    latitude: 'Kenglik',
    longitude: 'Uzunlik',
    latitudeExample: 'Masalan, 40.49598',
    longitudeExample: 'Masalan, 68.77587',
  },
  rideFallback: {
    toDestination: 'Manzilgacha {distance}',
    toStop: '{n}-oraliq manzilgacha {distance}',
  },
  locate: {
    placeOnMap: 'pinni xaritada o‘zingiz qo‘ying',
    placeFromSearch: 'manzilni qidiruvdan tanlang',
    denied: {
      title: 'Joylashuvga ruxsat berilmagan',
      message: 'Haydovchi sizni aniq topishi uchun joylashuvga ruxsat bering yoki {place}.',
      action: 'Ruxsat berish',
    },
    blocked: {
      title: 'Joylashuv ruxsati o‘chirilgan',
      message:
        'Sozlamalar → Ruxsatlar → Joylashuv bo‘limida «Ilova ishlatilayotganda»ni tanlang yoki {place}.',
      action: 'Sozlamalarni ochish',
    },
    servicesOff: {
      title: 'Telefonda joylashuv (GPS) o‘chiq',
      message: 'Joylashuvni yoqing — shunda olib ketish joyi aniq bo‘ladi. Yoki {place}.',
      action: 'Joylashuvni yoqish',
    },
    unavailable: {
      title: 'Joylashuv aniqlanmadi',
      message: 'Ochiqroq joyga chiqib qayta urinib ko‘ring yoki {place}.',
    },
  },
  area: {
    movePin: 'Pinni o‘sha tomonga suring.',
    pickFromSearch: 'Olib ketish joyini «Qayerdan» qatoridan tanlang.',
    tryElsewhere: 'Pinni boshqa joyga qo‘yib ko‘ring.',
    upcomingTitle: '{city} — tez orada',
    upcomingMessage:
      '{city} shahrida tez orada ishga tushamiz. Hozircha bu yerdan buyurtma berib bo‘lmaydi.',
    outsideTitle: 'Bu hududda hozircha ishlamaymiz',
    nearest: 'Eng yaqin xizmat hududi: {city}, {distance} uzoqlikda. {advice}',
    expanding: 'Xizmat hududlari tez orada kengayadi. {advice}',
  },
  offline: {
    noInternet: 'Internet aloqasi yo‘q. Qayta ulanmoqda…',
    noServer: 'Server bilan aloqa yo‘q. Qayta ulanmoqda…',
  },
  notice: {
    openA11y: '{text}. Ochish',
  },
  update: {
    title: 'Ilovani yangilang',
    message:
      'SFF Taxi’ning yangi versiyasi chiqdi. Buyurtma berishda davom etish uchun ilovani yangilang.',
    versions: 'Sizda: {current} · kerak: {minimum}',
    appStore: 'App Store’da yangilash',
    googlePlay: 'Google Play’da yangilash',
    appStoreManual: 'App Store’dan SFF Taxi ilovasini yangilang.',
    orderByPhone: 'Operator orqali buyurtma',
  },
  states: {
    offlineTitle: 'Aloqa yo‘q',
    errorTitle: 'Nimadir xato ketdi',
  },
  stepper: {
    decrease: 'Kamaytirish',
    increase: 'Ko‘paytirish',
  },
  push: {
    channelName: 'Safarlar',
    channelDescription: 'Haydovchi topildi, yetib keldi, buyurtma bekor qilindi',
  },
};
