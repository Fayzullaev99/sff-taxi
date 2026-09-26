/**
 * Notification texts in Uzbek (Latin, the default) and Russian. SMS texts are Uzbek only
 * and short (one 160-character Latin segment where possible): each must also be approved
 * as a template in the SMS provider's cabinet before production.
 */
export type Locale = 'uz' | 'ru';

export interface PushText {
  title: string;
  body: string;
}

export interface CarText {
  colour: string;
  make: string;
  model: string;
  plate: string;
}

/** 7000 -> '7 000 so‘m': thousands separated by spaces, as prices are written in Uzbekistan. */
const soum = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;
const car = (c: CarText) => `${c.colour} ${c.make} ${c.model}, ${c.plate}`;

export const push = {
  driverAssigned: (l: Locale, c: CarText, minutes: number | null): PushText =>
    l === 'ru'
      ? {
          title: 'Водитель найден',
          body: `${car(c)}${minutes ? `, прибудет через ~${minutes} мин` : ''}`,
        }
      : {
          title: 'Haydovchi topildi',
          body: `${car(c)}${minutes ? `, ~${minutes} daqiqada yetib keladi` : ''}`,
        },
  driverArrived: (l: Locale, c: CarText): PushText =>
    l === 'ru'
      ? { title: 'Водитель на месте', body: `Вас ждёт ${car(c)}. 2 минуты ожидания бесплатно.` }
      : {
          title: 'Haydovchi yetib keldi',
          body: `Sizni ${car(c)} kutmoqda. 2 daqiqa kutish bepul.`,
        },
  completed: (l: Locale, fare: number): PushText =>
    l === 'ru'
      ? { title: 'Поездка завершена', body: `К оплате ${soum(fare)}. Оцените поездку.` }
      : { title: 'Safar yakunlandi', body: `To‘lov: ${soum(fare)}. Safarni baholang.` },
  cancelledForRider: (l: Locale, reason: string | null): PushText =>
    l === 'ru'
      ? { title: 'Заказ отменён', body: reason ?? 'Свободных машин не нашлось' }
      : { title: 'Buyurtma bekor qilindi', body: reason ?? 'Bo‘sh mashina topilmadi' },
  searchingAgain: (l: Locale): PushText =>
    l === 'ru'
      ? { title: 'Ищем другого водителя', body: 'Водитель не сможет приехать, ищем замену.' }
      : {
          title: 'Boshqa haydovchi qidirilmoqda',
          body: 'Haydovchi kela olmaydi, o‘rniga boshqasini topamiz.',
        },
  riderCancelled: (l: Locale, number: number): PushText =>
    l === 'ru'
      ? { title: 'Пассажир отменил заказ', body: `Заказ #${number} отменён.` }
      : { title: 'Yo‘lovchi bekor qildi', body: `#${number} buyurtma bekor qilindi.` },
  rideTakenAway: (l: Locale, number: number): PushText =>
    l === 'ru'
      ? { title: 'Заказ передан другому водителю', body: `Заказ #${number} больше не ваш.` }
      : {
          title: 'Buyurtma boshqa haydovchiga berildi',
          body: `#${number} buyurtma endi sizniki emas.`,
        },
  newOffer: (l: Locale, fare: number, etaMinutes: number | null, pickup: string): PushText =>
    l === 'ru'
      ? {
          title: `Новый заказ: ${soum(fare)}`,
          body: `${pickup}${etaMinutes ? ` · ~${etaMinutes} мин до клиента` : ''}`,
        }
      : {
          title: `Yangi buyurtma: ${soum(fare)}`,
          body: `${pickup}${etaMinutes ? ` · mijozgacha ~${etaMinutes} daqiqa` : ''}`,
        },
  driverApproved: (l: Locale): PushText =>
    l === 'ru'
      ? { title: 'Заявка одобрена', body: 'Можно выходить на линию.' }
      : { title: 'Ariza tasdiqlandi', body: 'Liniyaga chiqishingiz mumkin.' },
  driverRejected: (l: Locale, reason: string | null): PushText =>
    l === 'ru'
      ? { title: 'Заявка отклонена', body: reason ?? 'Откройте приложение, чтобы узнать причину.' }
      : { title: 'Ariza rad etildi', body: reason ?? 'Sababini ilovada ko‘ring.' },
  driverBlocked: (l: Locale, reason: string | null): PushText =>
    l === 'ru'
      ? { title: 'Аккаунт заблокирован', body: reason ?? 'Свяжитесь с оператором.' }
      : { title: 'Hisob bloklandi', body: reason ?? 'Operator bilan bog‘laning.' },
  driverUnblocked: (l: Locale): PushText =>
    l === 'ru'
      ? { title: 'Аккаунт разблокирован', body: 'Можно снова выходить на линию.' }
      : { title: 'Hisob blokdan chiqarildi', body: 'Yana liniyaga chiqishingiz mumkin.' },
};

/** SMS to riders who ordered by phone and have no app. */
export const sms = {
  driverAssigned: (number: number, c: CarText, minutes: number | null, driverPhone: string) =>
    `SFF Taxi #${number}: ${car(c)}${minutes ? `, ~${minutes} daqiqada` : ''}. Haydovchi: ${driverPhone}`,
  driverArrived: (number: number, c: CarText) =>
    `SFF Taxi #${number}: haydovchi yetib keldi, ${car(c)}.`,
  cancelled: (number: number, reason: string | null) =>
    `SFF Taxi #${number}: buyurtma bekor qilindi${reason ? ` (${reason})` : ''}.`,
  sos: (number: number, role: 'rider' | 'driver', phone: string) =>
    `SFF Taxi SOS! Safar #${number}, ${role === 'rider' ? 'yo‘lovchi' : 'haydovchi'} ${phone}. Panelni oching.`,
};
