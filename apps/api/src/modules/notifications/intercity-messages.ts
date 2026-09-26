import type { Locale, PushText } from './messages.js';

/** Texts of the intercity trip board (Uzbek Latin default, Russian; SMS in Uzbek only). */

const soum = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;

/** "27.09 08:30" in Tashkent time. */
export function tashkentShort(at: Date): string {
  const t = new Date(at.getTime() + 5 * 3600_000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(t.getUTCDate())}.${two(t.getUTCMonth() + 1)} ${two(t.getUTCHours())}:${two(t.getUTCMinutes())}`;
}

export interface TripText {
  number: number;
  from: string;
  to: string;
  departureAt: Date;
  meetingPoint: string;
}

const route = (t: TripText) => `${t.from} → ${t.to}, ${tashkentShort(t.departureAt)}`;

export const intercityPush = {
  newBooking: (l: Locale, t: TripText, seats: number, price: number): PushText =>
    l === 'ru'
      ? { title: 'Новая бронь', body: `${route(t)}: ${seats} мест(а), ${soum(price)}` }
      : { title: 'Yangi bron', body: `${route(t)}: ${seats} ta joy, ${soum(price)}` },
  bookingCancelled: (l: Locale, t: TripText, seats: number): PushText =>
    l === 'ru'
      ? { title: 'Бронь отменена', body: `${route(t)}: освободилось мест: ${seats}` }
      : { title: 'Bron bekor qilindi', body: `${route(t)}: ${seats} ta joy bo‘shadi` },
  boarding: (l: Locale, t: TripText): PushText =>
    l === 'ru'
      ? { title: 'Водитель ждёт на месте сбора', body: `${route(t)}. ${t.meetingPoint}` }
      : { title: 'Haydovchi yig‘ilish joyida', body: `${route(t)}. ${t.meetingPoint}` },
  tripCancelled: (l: Locale, t: TripText, reason: string | null): PushText =>
    l === 'ru'
      ? { title: 'Поездка отменена', body: `${route(t)}${reason ? `: ${reason}` : ''}` }
      : { title: 'Qatnov bekor qilindi', body: `${route(t)}${reason ? `: ${reason}` : ''}` },
};

export const intercitySms = {
  booked: (b: number, t: TripText, seats: number, price: number, driver: string, car: string) =>
    `SFF Taxi bron #${b}: ${route(t)}, ${seats} joy, ${soum(price)}. ${t.meetingPoint}. Haydovchi ${driver}, ${car}`,
  boarding: (b: number, t: TripText) =>
    `SFF Taxi bron #${b}: haydovchi kutmoqda, ${t.meetingPoint}.`,
  cancelled: (b: number, t: TripText, reason: string | null) =>
    `SFF Taxi bron #${b}: ${route(t)} qatnovi bekor qilindi${reason ? ` (${reason})` : ''}.`,
};
