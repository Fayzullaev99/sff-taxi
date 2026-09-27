/**
 * The intercity trip board, driver side (API `driver/intercity`, architecture §11): publish
 * a departure between towns at a seat price within the band around the reference, then
 * run it — boarding (an hour before), board each passenger, depart (the absent become
 * no-shows), arrive (each booking is charged tax and commission). Seats are paid in cash.
 */

/**
 * The board's rules that `GET /v1/driver/config` does not publish (API gap): the API's
 * defaults (settings `intercity`). The API enforces the real values either way.
 */
export const INTERCITY_RULES = {
  bandPercent: 15,
  publishMinMinutesAhead: 15,
  publishMaxDaysAhead: 7,
  boardingOpensMinutes: 60,
  freeCancelMinutes: 60,
} as const;

/** "7:05", "07.05", "0705" → "07:05"; null when it is not a time of day. */
export function parseTime(input: string): string | null {
  const m = /^\s*(\d{1,2})\s*[:.\s]?\s*(\d{2})\s*$/.exec(input);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** A Tashkent date and time → the ISO instant the API takes (`departureAt`). */
export function departureIso(date: string, time: string): string {
  return `${date}T${time}:00+05:00`;
}

/** Why a departure time cannot be published (Uzbek), or null. */
export function departureProblem(
  iso: string,
  now: number,
  rules: { publishMinMinutesAhead: number; publishMaxDaysAhead: number } = INTERCITY_RULES,
): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Jo‘nash vaqtini SS:DD ko‘rinishida yozing';
  const minutes = (at - now) / 60_000;
  if (minutes < rules.publishMinMinutesAhead) {
    return `Jo‘nash vaqti kamida ${rules.publishMinMinutesAhead} daqiqadan keyin bo‘lsin`;
  }
  if (minutes > rules.publishMaxDaysAhead * 1440) {
    return `Qatnovni ${rules.publishMaxDaysAhead} kundan uzoqqa e’lon qilib bo‘lmaydi`;
  }
  return null;
}

export interface Band {
  min: number;
  max: number;
}

/** Why a rear seat price is refused (the API's rule: within the band, a multiple of 100). */
export function priceProblem(price: number, band: Band): string | null {
  if (!Number.isInteger(price) || price <= 0) return 'Narxni so‘mda yozing';
  if (price % 100 !== 0) return 'Narx 100 so‘mga karrali bo‘lsin';
  if (price < band.min || price > band.max) {
    return `Narx ${fmt(band.min)}–${fmt(band.max)} so‘m oralig‘ida bo‘lsin`;
  }
  return null;
}

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Price ± `delta`, kept inside the band and on whole hundreds. */
export function stepPrice(price: number, delta: number, band: Band): number {
  const next = Math.round((price + delta) / 100) * 100;
  return Math.min(band.max, Math.max(band.min, next));
}

/**
 * The front seat's price for an asked rear price, keeping the reference's proportion
 * (the API's driverSeatPrices), so the driver sees both before publishing.
 */
export function frontPriceFor(rear: number, reference: { rear: number; front: number }): number {
  if (rear === reference.rear) return reference.front;
  return Math.ceil((rear * reference.front) / reference.rear / 100) * 100;
}

export type TripStatus = 'scheduled' | 'boarding' | 'departed' | 'arrived' | 'cancelled';
export type BookingStatus = 'booked' | 'boarded' | 'completed' | 'cancelled' | 'no_show';

export const TRIP_STATUS_TEXT: Record<string, string> = {
  scheduled: 'E’lon qilingan',
  boarding: 'Yo‘lovchilar yig‘ilmoqda',
  departed: 'Yo‘lda',
  arrived: 'Yetib kelindi',
  cancelled: 'Bekor qilingan',
};

export const BOOKING_STATUS_TEXT: Record<string, string> = {
  booked: 'Bron qilgan',
  boarded: 'Mashinada',
  completed: 'Yetkazildi',
  cancelled: 'Bekor qildi',
  no_show: 'Kelmadi',
};

export interface TripLike {
  status: string;
  departureAt: string;
  bookings: { status: string; seats: number }[];
}

export interface TripActions {
  /** "Yig‘ishni boshlash" is possible now. */
  canOpenBoarding: boolean;
  /** When boarding can be opened (ms), while it is still too early. */
  boardingOpensAt: number | null;
  canBoard: boolean;
  canDepart: boolean;
  canArrive: boolean;
  canCancel: boolean;
  /** Booked but not aboard yet (they become no-shows on departure). */
  waiting: number;
  aboard: number;
}

/** What the driver can do with a trip now (the API decides; this only shapes the buttons). */
export function tripActions(
  trip: TripLike,
  now: number,
  boardingOpensMinutes: number = INTERCITY_RULES.boardingOpensMinutes,
): TripActions {
  const departure = Date.parse(trip.departureAt);
  const opensAt = departure - boardingOpensMinutes * 60_000;
  const waiting = trip.bookings
    .filter((b) => b.status === 'booked')
    .reduce((s, b) => s + b.seats, 0);
  const aboard = trip.bookings
    .filter((b) => b.status === 'boarded')
    .reduce((s, b) => s + b.seats, 0);
  const open = trip.status === 'scheduled' || trip.status === 'boarding';
  return {
    canOpenBoarding: trip.status === 'scheduled' && now >= opensAt,
    boardingOpensAt: trip.status === 'scheduled' && now < opensAt ? opensAt : null,
    canBoard: open,
    canDepart: trip.status === 'boarding' && aboard > 0,
    canArrive: trip.status === 'departed',
    canCancel: open,
    waiting,
    aboard,
  };
}

/** Seats sold on a trip (live bookings). */
export function seatsSold(bookings: { status: string; seats: number }[]): number {
  return bookings
    .filter((b) => b.status === 'booked' || b.status === 'boarded' || b.status === 'completed')
    .reduce((s, b) => s + b.seats, 0);
}
