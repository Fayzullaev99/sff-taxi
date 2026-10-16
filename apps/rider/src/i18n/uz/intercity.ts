/** Texts of the intercity screens (Uzbek Latin, the source language). */
export const intercity = {
  /** The trip board: the search form and the departures found. */
  board: {
    fromLabel: 'QAYERDAN',
    toLabel: 'QAYERGA',
    from: 'Qayerdan',
    to: 'Qayerga',
    fromQuestion: 'Qayerdan?',
    toQuestion: 'Qayerga?',
    notChosen: 'tanlanmagan',
    townA11y: '{field}: {town}. Tanlash',
    chooseTown: 'Shaharni tanlang',
    swapTowns: 'Shaharlarni almashtirish',
    passengers: 'Yo‘lovchilar',
    pickDestination: 'Qayerga borishingizni tanlang — shu kunning qatnovlari chiqadi.',
    noTripsTitle: 'Bu kunga qatnov yo‘q',
    noTripsMessage:
      'Boshqa kunni tanlang yoki keyinroq qarang: haydovchilar qatnovlarni 7 kun oldin e’lon qiladi.',
    noTownsTitle: 'Shaharlar topilmadi',
    noTownsMessage: 'Shaharlar ro‘yxati hozircha bo‘sh. Keyinroq qayta urinib ko‘ring.',
    alongLine: 'Yo‘l-yo‘lakay: siz {from} → {to}',
    boarding: 'Mashinaga o‘tirish: {hint}',
    fullRoutePrice: 'butun yo‘l {price}',
    frontPrice: 'oldinda {price}',
    tripA11y: 'Soat {time}, {car}, {seats}, orqa o‘rindiq {rear}',
    tripA11yAlong: 'Soat {time}, yo‘l-yo‘lakay, {car}, {seats}, orqa o‘rindiq {rear}',
  },
  /** One departure and booking seats on it. */
  trip: {
    alongLine: 'Yo‘l-yo‘lakay: {from} → {to} · narx sizning qismingiz uchun',
    hasBooking: 'Bu qatnovda broningiz bor',
    viewBooking: 'Bronni ko‘rish',
    car: 'Mashina',
    driver: 'Haydovchi',
    rides: { other: '{count} safar' },
    contactAfterBooking: 'Haydovchi telefoni va mashina raqami joy band qilingach ko‘rinadi.',
    noteLabel: 'Haydovchi uchun izoh (ixtiyoriy)',
    notePlaceholder: 'Masalan: katta sumkam bor, avtovokzal oldida kutaman',
    fixedPrice: 'Narx qatnovda belgilangan va o‘zgarmaydi.',
    cashFixedPrice: 'To‘lov naqd, haydovchiga. Narx qatnovda belgilangan va o‘zgarmaydi.',
    closed: 'Bu qatnovga bron yopilgan.',
    book: 'Joy band qilish',
    bookSeats: { other: '{count} ta joyni band qilish' },
    bookWithDeposit: 'Band qilish · depozit {deposit}',
    offlineRetry: 'Aloqa yo‘q. Qayta bosing — joy ikki marta band qilinmaydi.',
    stops: {
      meetingPoint: 'Uchrashuv joyi',
      distance: 'Masofa',
      boardingPoint: 'O‘tirish joyi',
      time: 'Vaqti',
      alightingPoint: 'Tushish joyi',
      about: 'taxminan {time}',
    },
  },
  /** One booking: its lines, contact, and cancelling it. */
  booking: {
    number: 'Bron #{number}',
    plateA11y: 'Davlat raqami {plate}',
    callDriver: 'Haydovchiga qo‘ng‘iroq qilish: {name}',
    alongTheWay: 'Yo‘l-yo‘lakay',
    seats: 'Joylar',
    seatsOneFront: '{seats} (biri oldinda)',
    price: 'Narx',
    priceCash: 'Narx (naqd)',
    depositUnpaid: 'Depozit (kartadan)',
    depositPaid: 'Depozit to‘langan',
    cashToDriver: 'Haydovchiga naqd',
    yourNote: 'Izohingiz',
    cancellationFee: 'Bekor qilish to‘lovi',
    cancelAction: 'Bronni bekor qilish',
    cancelTitle: 'Bronni bekor qilasizmi?',
    cancelWithFee: 'Bekor qilish ({fee})',
    keep: 'Qoldirish',
    otherTrips: 'Boshqa qatnovlar',
    /** What cancelling costs now (bookingCancelTerms). */
    cancel: {
      unpaidFree: 'Depozit hali to‘lanmagan: bekor qilish bepul.',
      depositRefundUntil:
        'Soat {time} gacha bekor qilsangiz, depozit {deposit} kartangizga qaytariladi. Keyin u haydovchiga qoladi.',
      depositKept: {
        other:
          'Jo‘nashga {count} daqiqadan kam qoldi: bekor qilsangiz, depozit {deposit} haydovchiga qoladi.',
      },
      freeUntil:
        'Soat {time} gacha bekor qilish bepul. Keyin bron narxining {percent}% i to‘lanadi.',
      free: 'Bekor qilish bepul.',
      lateFee: {
        other:
          'Jo‘nashga {count} daqiqadan kam qoldi: bekor qilsangiz {fee} ({percent}%) haydovchiga yoziladi.',
      },
    },
    /** The general rule (cancelRuleText). */
    rules: {
      freeAnytime: 'Bronni istalgan vaqtda bepul bekor qilish mumkin.',
      freeBefore: {
        other:
          'Jo‘nashdan {count} daqiqa oldingacha bepul bekor qilish mumkin. Undan keyin bron narxining {percent}% i haydovchiga yoziladi.',
      },
    },
    /** Why a booking ended (bookingCancelledText). */
    ended: {
      noShow: 'Mashina jo‘nab ketganda siz yo‘q edingiz: bron yopildi.',
      byRider: 'Siz bronni bekor qildingiz.',
      feeNote: 'Bekor qilish to‘lovi: {fee}.',
      byDriver: 'Haydovchi qatnovni bekor qildi.',
      byDriverReason: 'Haydovchi qatnovni bekor qildi: {reason}.',
      byOperator: 'Operator bronni bekor qildi.',
      byOperatorReason: 'Operator bronni bekor qildi: {reason}.',
      depositUnpaid:
        'Depozit o‘z vaqtida to‘lanmadi: bron bekor qilindi, joylar bo‘shatildi. Kartadan pul yechilmadi.',
      generic: 'Bron bekor qilindi.',
      genericReason: 'Bron bekor qilindi: {reason}.',
    },
  },
  /** The rider's list of bookings. */
  bookings: {
    emptyTitle: 'Bronlar yo‘q',
    emptyMessage:
      'Shaharlararo qatnovlardan joy band qiling: narx oldindan ma’lum, joy kichik oldindan to‘lov bilan band qilinadi, qolgani naqd.',
    viewTrips: 'Qatnovlarni ko‘rish',
    seats: { other: '{count} joy' },
    frontMark: '(old)',
    rowA11y: '{from} dan {to} ga, {when}, {status}',
  },
  /** Seats: how many are free, the front one. */
  seats: {
    free: { other: '{count} ta bo‘sh joy' },
    frontAvailable: 'old o‘rindiq bor',
    count: 'Joylar soni',
    freeRear: { other: '{count} ta bo‘sh · orqada {rear}' },
    front: 'Old o‘rindiq',
    frontA11y: 'Old o‘rindiq, {price}',
    frontA11yTaken: 'Old o‘rindiq, {price}, band',
    frontPrice: '{price} — bitta joy oldinda',
    frontPriceSurcharge: '{price} (+{surcharge}) — bitta joy oldinda',
    frontTaken: 'Band qilingan',
  },
  /** Deposits: a seat on the board and a ride for later (lib/deposit.ts). */
  deposit: {
    title: 'Oldindan to‘lov (depozit)',
    expired:
      'To‘lov tekshirilmoqda. To‘lamagan bo‘lsangiz, bron bir necha daqiqada bekor qilinadi va kartadan pul yechilmaydi.',
    waiting:
      'To‘lov hali kelmadi. To‘lov sahifasida to‘lovni yakunlang — tasdiq kelishi bilan joy band bo‘ladi.',
    bookingHold: {
      other:
        'Joy {deposit} oldindan to‘lov (depozit) kartadan {count} daqiqa ichida to‘langach band bo‘ladi, qolgan {cash} naqd haydovchiga.',
    },
    bookingCancel: {
      other:
        'Jo‘nashdan {count} daqiqa oldingacha bekor qilsangiz, depozit qaytariladi; keyin yoki kelmasangiz, haydovchiga qoladi.',
    },
    rideHold:
      'Buyurtma {amount} oldindan to‘lov (depozit) kartadan to‘langach tasdiqlanadi, qolgan {cash} naqd haydovchiga.',
    rideCancel: {
      other:
        'Vaqtidan {count} daqiqa oldingacha{until} bekor qilsangiz, depozit qaytariladi; keyin bekor qilinsa, u kutgan haydovchiga qoladi.',
    },
    untilNote: '({datetime} gacha)',
    rideRefund: 'Depozit {deposit} kartangizga qaytariladi.',
    rideKept: {
      other: 'Vaqtiga {count} daqiqadan kam qoldi: depozit {deposit} haydovchiga qoladi.',
    },
  },
  /** Status labels, by the API's codes. */
  status: {
    booking: {
      awaiting_payment: 'Depozit kutilmoqda',
      booked: 'Band qilingan',
      boarded: 'Mashinadasiz',
      completed: 'Yetib keldi',
      cancelled: 'Bekor qilingan',
      no_show: 'Kelmadingiz',
    },
    trip: {
      scheduled: 'Jo‘nashni kutmoqda',
      boarding: 'Yo‘lovchilar o‘tirmoqda',
      departed: 'Yo‘lda',
      arrived: 'Yetib keldi',
      cancelled: 'Qatnov bekor qilindi',
    },
  },
};
