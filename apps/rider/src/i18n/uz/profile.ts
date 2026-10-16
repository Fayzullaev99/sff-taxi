/** Texts of the profile screens (Uzbek Latin, the source language). */
export const profile = {
  phone: 'Telefon',
  nameLabel: 'Ism',
  namePlaceholder: 'Haydovchi sizga shu ism bilan murojaat qiladi',
  nameSaved: 'Ism saqlandi',
  gender: {
    title: 'Jinsingiz',
    hint: 'Ayollar buyurtmada «Ayol haydovchi»ni tanlashi mumkin.',
    confirmTitle: 'Jins: {gender}',
    confirmMessage:
      'Jinsni 30 kunda bir marta o‘zgartirish mumkin. Ayol haydovchi tanlovi faqat ayollar uchun.',
  },
  menu: {
    promosSubtitle: 'Do‘stni taklif qiling — bonus oling',
    intercityBookings: 'Shaharlararo bronlarim',
    supportSubtitle: 'Shikoyatlar va unutilgan narsalar',
  },
  push: {
    title: 'Bildirishnomalar',
    on: 'Yoqilgan: haydovchi topilganda va yetib kelganda xabar beramiz.',
    unsupported: 'Bu qurilmada bildirishnomalar mavjud emas.',
    off: 'O‘chirilgan. Haydovchi yetib kelganini bilish uchun yoqing.',
    enable: 'Bildirishnomalarni yoqish',
  },
  help: {
    title: 'Yordam',
    text: 'Narxlar oldindan belgilanadi va yo‘lda o‘zgarmaydi. Haydovchi yetib kelgach bir necha daqiqa kutish bepul.',
  },
  signOut: {
    title: 'Hisobdan chiqasizmi?',
    message: 'Saqlangan manzillar va safarlar hisobingizda qoladi: qayta kirganda ko‘rasiz.',
    confirm: 'Chiqish',
  },
  /** The promo codes and bonuses screen. */
  promos: {
    codeTitle: 'Promokod',
    codeHint: 'Kodni kiriting: mos safarda chegirma buyurtmada o‘zi ko‘rinadi.',
    codeHintReferral: 'Do‘stingizning taklif kodi ham shu yerga.',
    invitedBy: 'Do‘st taklifi ({code}): birinchi safaringizga chegirma',
    myCodes: 'Promokodlarim',
    bonusTitle: 'Bonus',
    bonusHint: 'Keyingi safarlarda o‘zi ishlatiladi: safar narxining {percent}% gacha.',
    historyOpen: 'Bonus tarixi',
    historyClose: 'Tarixni yopish',
    remove: {
      title: '{code} o‘chirilsinmi?',
      message: 'Kodni keyin yana kiritishingiz mumkin.',
      failed: 'O‘chirilmadi',
      a11y: '{code} ni o‘chirish',
    },
    loading: 'Yuklanmoqda…',
    noBonus:
      'Hali bonus yo‘q. Do‘stlaringizni taklif qiling — ular birinchi safarni yakunlagach bonus olasiz.',
    invite: {
      title: 'Do‘stni taklif qil',
      yourCode: 'Taklif kodingiz',
      yourCodeA11y: 'Taklif kodingiz: {code}',
      stats: 'Taklif qildingiz: {invited} · bonus olindi: {rewarded} · jami {earned}',
    },
  },
  /** How promo codes, credit entries and the invitation read (src/lib/promo.ts). */
  promo: {
    fixedDiscount: '{amount} chegirma',
    percentDiscount: '{percent}% chegirma',
    percentDiscountCapped: '{percent}% chegirma, {amount}gacha',
    cargoS: 'Kichik yuk',
    cargoM: 'O‘rta yuk',
    services: {
      taxi: 'taksi',
      delivery: 'yetkazish',
      cargo: 'yuk tashish',
    },
    minFare: '{amount}dan',
    firstRideOnly: 'birinchi safar uchun',
    validUntil: '{date} gacha',
    credit: {
      referral_bonus: 'Do‘stingiz uchun bonus',
      ride: 'Safarda ishlatildi',
      ride_release: 'Bekor qilingan safar: qaytarildi',
      revoke: 'Bonus bekor qilindi',
      adjustment: 'Tuzatish',
    },
    inviteOffer: 'Do‘stingizga birinchi safarga {gift}, sizga u safarni yakunlagach {bonus} bonus.',
    inviteGift: '{percent}% chegirma ({amount}gacha)',
    inviteGiftPlain: 'chegirma',
    referralLine: 'Do‘st taklifi',
    promoLine: 'Promokod {code}',
    bonusLine: 'Bonus',
  },
  /** An invitation link opened in the app. */
  invite: {
    title: 'Do‘stingiz sizni SFF Taxiga taklif qildi',
    text: 'Taklif kodi bilan birinchi safaringiz arzonroq. Kod faqat birinchi safargacha va bir marta kiritiladi.',
    signIn: 'Kirish va kodni qo‘llash',
    signInA11y: 'Kirish, keyin {code} kodini qo‘llash',
    later: 'Keyinroq',
  },
  /** A promo-code link from an ad or the landing site (promo/[code].tsx). */
  promoLink: {
    title: 'Sizga promokod: {code}',
    text: 'Kod hamyoningizga saqlanadi va mos safarda chegirma narxda ko‘rinadi. Shartlari kod yonida yoziladi.',
    signIn: 'Kirish va kodni qo‘llash',
    signInA11y: 'Kirish, keyin {code} kodini qo‘llash',
    later: 'Keyinroq',
  },
  links: {
    callFailed: 'Qo‘ng‘iroq qilib bo‘lmadi',
    dialManually: 'Raqamni qo‘lda tering: {phone}',
    openFailed: 'Havolani ochib bo‘lmadi',
  },
};
