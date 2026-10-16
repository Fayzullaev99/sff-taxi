import type { Language } from '../../core/i18n/language.js';
import { translate } from '../../core/i18n/translate.js';
import { colourText } from '../../lib/vehicle-colour.js';

/**
 * Notification texts in Uzbek (Latin, the default) and Russian. Push follows the device's
 * registered language, SMS the recipient's account language (users.locale; Uzbek for a
 * phone without an account). SMS texts are short (one 160-character Latin segment where
 * possible; Russian ones fit one 70-character Cyrillic segment or two): each must also be
 * approved as a template in the SMS provider's cabinet before production.
 */
export type Locale = Language;
/** The ride's service: cargo and delivery rides get their own wording. */
type Service = 'taxi' | 'cargo' | 'delivery';

export interface PushText {
  title: string;
  body: string;
}

export interface CarText {
  /** As stored: a colour code, or free text written before the list (shown as it is). */
  colour: string;
  make: string;
  model: string;
  plate: string;
}

/** 7000 -> '7 000 so‘m': thousands separated by spaces, as prices are written in Uzbekistan. */
const soum = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;
/** "qora Chevrolet Cobalt, 20 A 123 BC" / "чёрный Chevrolet Cobalt, …": the colour in the language. */
const car = (l: Locale, c: CarText) =>
  `${colourText(c.colour, l)} ${c.make} ${c.model}, ${c.plate}`;

export const push = {
  driverAssigned: (
    l: Locale,
    c: CarText,
    minutes: number | null,
    service: Service = 'taxi',
  ): PushText =>
    l === 'ru'
      ? {
          title: service === 'cargo' ? 'Грузовая машина найдена' : 'Водитель найден',
          body: `${car(l, c)}${minutes ? `, прибудет через ~${minutes} мин` : ''}`,
        }
      : {
          title: service === 'cargo' ? 'Yuk mashinasi topildi' : 'Haydovchi topildi',
          body: `${car(l, c)}${minutes ? `, ~${minutes} daqiqada yetib keladi` : ''}`,
        },
  driverArrived: (l: Locale, c: CarText): PushText =>
    l === 'ru'
      ? { title: 'Водитель на месте', body: `Вас ждёт ${car(l, c)}. 2 минуты ожидания бесплатно.` }
      : {
          title: 'Haydovchi yetib keldi',
          body: `Sizni ${car(l, c)} kutmoqda. 2 daqiqa kutish bepul.`,
        },
  completed: (l: Locale, fare: number, service: Service = 'taxi'): PushText => {
    if (service === 'delivery') {
      return l === 'ru'
        ? { title: 'Посылка доставлена', body: `К оплате ${soum(fare)}. Оцените доставку.` }
        : { title: 'Posilka yetkazildi', body: `To‘lov: ${soum(fare)}. Xizmatni baholang.` };
    }
    if (service === 'cargo') {
      return l === 'ru'
        ? { title: 'Груз доставлен', body: `К оплате ${soum(fare)}. Оцените перевозку.` }
        : { title: 'Yuk yetkazildi', body: `To‘lov: ${soum(fare)}. Xizmatni baholang.` };
    }
    return l === 'ru'
      ? { title: 'Поездка завершена', body: `К оплате ${soum(fare)}. Оцените поездку.` }
      : { title: 'Safar yakunlandi', body: `To‘lov: ${soum(fare)}. Safarni baholang.` };
  },
  /** The sender of a parcel: the driver has it and is on the way to the recipient. */
  parcelPickedUp: (l: Locale, c: CarText): PushText =>
    l === 'ru'
      ? { title: 'Посылка в пути', body: `Её везёт ${car(l, c)}.` }
      : { title: 'Posilka yo‘lda', body: `Uni ${car(l, c)} olib ketmoqda.` },
  // a system reason is a known Uzbek text (translated); an operator's reason stays as typed
  cancelledForRider: (l: Locale, reason: string | null): PushText =>
    l === 'ru'
      ? {
          title: 'Заказ отменён',
          body: reason ? translate(reason, l) : 'Свободных машин не нашлось',
        }
      : { title: 'Buyurtma bekor qilindi', body: reason ?? 'Bo‘sh mashina topilmadi' },
  scheduledStarted: (l: Locale): PushText =>
    l === 'ru'
      ? {
          title: 'Ищем машину к вашему времени',
          body: 'Заказ на потом: водитель скоро будет назначен.',
        }
      : {
          title: 'Belgilangan vaqtga mashina qidirilmoqda',
          body: 'Oldindan buyurtmangiz: haydovchi tez orada tayinlanadi.',
        },
  poolJoined: (l: Locale, pays: number): PushText =>
    l === 'ru'
      ? { title: 'К вам подсел попутчик', body: `Поездка дешевле: теперь ${soum(pays)}.` }
      : { title: 'Yo‘lingizga hamroh qo‘shildi', body: `Safar arzonlashdi: endi ${soum(pays)}.` },
  poolLeft: (l: Locale, pays: number): PushText =>
    l === 'ru'
      ? { title: 'Попутчик отменил поездку', body: `Стоимость поездки: ${soum(pays)}.` }
      : { title: 'Hamroh safarni bekor qildi', body: `Safar narxi: ${soum(pays)}.` },
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
  /** The rider changed the intermediate stops: the route and the cash to take changed. */
  stopsChanged: (l: Locale, number: number, stops: number, cash: number): PushText =>
    l === 'ru'
      ? {
          title: 'Пассажир изменил остановки',
          body: `Заказ #${number}: ${stops ? `остановок: ${stops}` : 'без остановок'}, наличными ${soum(cash).replace('so‘m', 'сум')}. Маршрут обновлён.`,
        }
      : {
          title: 'Yo‘lovchi manzillarni o‘zgartirdi',
          body: `#${number}: ${stops ? `${stops} ta oraliq manzil` : 'oraliq manzilsiz'}, naqd ${soum(cash)}. Yo‘nalish yangilandi.`,
        },
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
  refundQueued: (l: Locale, number: number, amount: number): PushText =>
    l === 'ru'
      ? {
          title: 'Возврат оформлен',
          body: `Заказ #${number}: ${soum(amount)} вернутся на вашу карту.`,
        }
      : {
          title: 'Pul qaytarilmoqda',
          body: `#${number} buyurtma: ${soum(amount)} kartangizga qaytariladi.`,
        },
  refunded: (l: Locale, number: number, amount: number): PushText =>
    l === 'ru'
      ? {
          title: 'Деньги возвращены',
          body: `Заказ #${number}: ${soum(amount)} возвращены на карту.`,
        }
      : {
          title: 'Pul qaytarildi',
          body: `#${number} buyurtma: ${soum(amount)} kartangizga qaytarildi.`,
        },
  complaintAnswered: (l: Locale, number: number): PushText =>
    l === 'ru'
      ? { title: 'Ответ на обращение', body: `Оператор ответил по заказу #${number}.` }
      : {
          title: 'Murojaatingizga javob',
          body: `Operator #${number} buyurtma bo‘yicha javob berdi.`,
        },
  complaintResolved: (l: Locale, number: number): PushText =>
    l === 'ru'
      ? { title: 'Обращение рассмотрено', body: `Решение по заказу #${number} в приложении.` }
      : { title: 'Murojaat ko‘rib chiqildi', body: `#${number} buyurtma bo‘yicha qaror ilovada.` },
  topupPaid: (l: Locale, amount: number): PushText =>
    l === 'ru'
      ? { title: 'Баланс пополнен', body: `Зачислено ${soum(amount)}.` }
      : { title: 'Balans to‘ldirildi', body: `${soum(amount)} hisobingizga tushdi.` },
  appealAnswered: (l: Locale): PushText =>
    l === 'ru'
      ? { title: 'Ответ на обращение', body: 'Оператор ответил на вашу апелляцию.' }
      : { title: 'Murojaatingizga javob', body: 'Operator murojaatingizga javob berdi.' },
  driverUnblocked: (l: Locale): PushText =>
    l === 'ru'
      ? { title: 'Аккаунт разблокирован', body: 'Можно снова выходить на линию.' }
      : { title: 'Hisob blokdan chiqarildi', body: 'Yana liniyaga chiqishingiz mumkin.' },
};

/**
 * SMS to riders who ordered by phone and have no app, to passengers of rides ordered for
 * them and to parcel recipients, in the recipient's language.
 */
export const sms = {
  driverAssigned: (
    l: Locale,
    number: number,
    c: CarText,
    minutes: number | null,
    driverPhone: string,
  ) =>
    l === 'ru'
      ? `SFF Taxi #${number}: ${car(l, c)}${minutes ? `, ~${minutes} мин` : ''}. Водитель: ${driverPhone}`
      : `SFF Taxi #${number}: ${car(l, c)}${minutes ? `, ~${minutes} daqiqada` : ''}. Haydovchi: ${driverPhone}`,
  driverArrived: (l: Locale, number: number, c: CarText) =>
    l === 'ru'
      ? `SFF Taxi #${number}: водитель на месте, ${car(l, c)}.`
      : `SFF Taxi #${number}: haydovchi yetib keldi, ${car(l, c)}.`,
  /** The recipient of a parcel: who brings it and how to reach the driver. */
  parcelOnTheWay: (l: Locale, number: number, c: CarText, driverPhone: string) =>
    l === 'ru'
      ? `SFF Taxi #${number}: к вам едет посылка, ${car(l, c)}. Водитель: ${driverPhone}`
      : `SFF Taxi #${number}: sizga posilka yo‘lda, ${car(l, c)}. Haydovchi: ${driverPhone}`,
  /** The passenger of a ride someone ordered for them: the car, the driver, the live link. */
  passengerAssigned: (
    l: Locale,
    number: number,
    c: CarText,
    minutes: number | null,
    driverPhone: string,
    url: string,
    pin: string | null,
  ) =>
    l === 'ru'
      ? `SFF Taxi #${number}: за вами ${car(l, c)}${minutes ? `, ~${minutes} мин` : ''}. Водитель: ${driverPhone}.${pin ? ` Код: ${pin}.` : ''} Отследить: ${url}`
      : `SFF Taxi #${number}: sizga ${car(l, c)}${minutes ? `, ~${minutes} daqiqada` : ''}. Haydovchi: ${driverPhone}.${pin ? ` Kod: ${pin}.` : ''} Kuzatish: ${url}`,
  cancelled: (l: Locale, number: number, reason: string | null) =>
    l === 'ru'
      ? `SFF Taxi #${number}: заказ отменён${reason ? ` (${translate(reason, l)})` : ''}.`
      : `SFF Taxi #${number}: buyurtma bekor qilindi${reason ? ` (${reason})` : ''}.`,
  /** To operators (always Uzbek: the panel's language). */
  sos: (number: number, role: 'rider' | 'driver', phone: string) =>
    `SFF Taxi SOS! Safar #${number}, ${role === 'rider' ? 'yo‘lovchi' : 'haydovchi'} ${phone}. Panelni oching.`,
};
