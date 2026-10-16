/** Texts of the payments screens (Uzbek Latin, the source language). */
export const payments = {
  checking: 'To‘lov tekshirilmoqda…',
  cardWith: 'Karta ({providers})',
  payVia: '{provider} orqali to‘lash',
  refundPending: {
    title: 'Pul kartangizga qaytariladi',
    message:
      'Oldindan to‘langan {amount} to‘liq qaytariladi. Bank odatda 1–3 ish kunida o‘tkazadi.',
  },
  refunded: {
    title: 'Pul qaytarildi',
    messageAt: '{amount} kartangizga qaytarildi ({when}).',
    message: '{amount} kartangizga qaytarildi.',
  },
  failed: {
    title: 'To‘lov amalga oshmadi',
    message: 'To‘lov 10 daqiqa ichida qilinmadi, buyurtma bekor qilindi. Kartadan pul yechilmadi.',
  },
  notCharged: {
    title: 'Kartadan pul yechilmadi',
    message: 'Buyurtma to‘lovdan oldin bekor qilindi.',
  },
  paid: {
    title: 'Karta orqali to‘langan',
    message: 'Oldindan to‘langan: {amount}.',
  },
};
