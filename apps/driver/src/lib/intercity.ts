/**
 * The intercity trip board, driver side (API `driver/intercity`, architecture §11): publish
 * a departure between towns at a seat price within the band around the reference, then
 * run it — boarding (an hour before), board each passenger, depart (the absent become
 * no-shows), arrive (each booking is charged tax and commission). Seats are paid in cash.
 */

import { DEFAULT_INTERCITY_RULES, type IntercityRules } from './driver-config';
import { distance, time } from './format';

/**
 * The board's launch rules, until `GET /v1/driver/config` (`intercity`) loads: screens take
 * `useDriverConfig().intercity`. The API enforces the real values either way.
 */
export const INTERCITY_RULES: IntercityRules = DEFAULT_INTERCITY_RULES;

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

export interface EditableTrip {
  status: string;
  seats: { total: number; free: number };
  bookings: { status: string }[];
}

/**
 * Whether the driver may still change the trip (`PATCH /driver/intercity/trips/:id`): only
 * while it is announced and nobody holds a seat — riders who booked rely on what they saw.
 */
export function tripEditable(trip: EditableTrip): boolean {
  if (trip.status !== 'scheduled') return false;
  if (trip.seats.free < trip.seats.total) return false;
  return !trip.bookings.some((b) => b.status === 'booked' || b.status === 'boarded');
}

/** A departure instant → its Tashkent day and time, as the publish form holds them. */
export function departureParts(iso: string): { date: string; time: string } {
  const local = new Date(Date.parse(iso) + 5 * 3_600_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** What the publish form holds (also when it edits a trip). */
export interface TripForm {
  departureAt: string;
  seats: number;
  frontSeat: boolean;
  priceRear: number;
  /** Empty: the town's meeting point. */
  meetingPoint: string;
  comment: string;
}

export interface TripEditBody {
  departureAt?: string;
  seats?: number;
  frontSeat?: boolean;
  priceRear?: number | null;
  meetingPoint?: string | null;
  comment?: string | null;
}

export interface TripSnapshot {
  departureAt: string;
  seats: { total: number; frontOffered: boolean };
  price: { rear: number };
  meetingPoint: string | null;
  comment: string | null;
}

/**
 * The fields that changed, for the PATCH (it takes only what changes); null when nothing
 * did. An emptied meeting point or comment is sent as null (the town's point, no comment).
 */
export function tripEdits(trip: TripSnapshot, form: TripForm): TripEditBody | null {
  const body: TripEditBody = {};
  if (Date.parse(form.departureAt) !== Date.parse(trip.departureAt)) {
    body.departureAt = form.departureAt;
  }
  if (form.seats !== trip.seats.total) body.seats = form.seats;
  if (form.frontSeat !== trip.seats.frontOffered) body.frontSeat = form.frontSeat;
  if (form.priceRear !== trip.price.rear) body.priceRear = form.priceRear;
  const meeting = form.meetingPoint.trim() || null;
  if (meeting !== (trip.meetingPoint ?? null)) body.meetingPoint = meeting;
  const comment = form.comment.trim() || null;
  if (comment !== (trip.comment ?? null)) body.comment = comment;
  return Object.keys(body).length ? body : null;
}

/**
 * The seats a trip may offer: at most maxSeats (3) and never more than maxRearSeats (2)
 * in the back — so without the front seat only 2 — and never more than the car has.
 */
export function maxTripSeats(
  vehicleSeats: number,
  frontSeat: boolean,
  rules: { maxSeats: number; maxRearSeats: number },
): number {
  const byRule = frontSeat ? Math.min(rules.maxSeats, rules.maxRearSeats + 1) : rules.maxRearSeats;
  return Math.max(1, Math.min(byRule, Math.floor(vehicleSeats) || 1));
}

/**
 * A booking's money: the cash the driver takes at boarding and the part paid by card in
 * advance (the driver's once the trip is done). An older API without deposits: all cash.
 */
export function bookingMoney(b: { price: number; depositAmount?: number; payCash?: number }): {
  cash: number;
  deposit: number;
} {
  const deposit = Math.max(0, b.depositAmount ?? 0);
  return { cash: Math.max(0, b.payCash ?? b.price - deposit), deposit };
}

/** "Boyovut → Yangiyer" for a seat along the way, else null. */
export function alongTheWayText(b: {
  alongTheWay?: boolean;
  pickup?: { nameUz: string } | null;
  dropoff?: { nameUz: string } | null;
}): string | null {
  if (!b.alongTheWay) return null;
  return `${b.pickup?.nameUz ?? 'Yo‘lda'} → ${b.dropoff?.nameUz ?? 'yo‘lda'}`;
}

/** The API's boardingPoint / alightingPoint / partDistanceM of a booking. */
export interface BookingStops {
  alongTheWay?: boolean;
  boardingPoint?: { name: string; meetingPoint: string; estimatedAt: string } | null;
  alightingPoint?: { name: string; meetingPoint: string } | null;
  partDistanceM?: number | null;
}

/**
 * Where to pick up and drop off a rider along the way: their town's meeting point about when
 * the car passes it, their drop-off town's point, and their part of the road. Empty for a
 * whole-trip seat (they come to the trip's meeting point) or an older API.
 */
export function alongStopLines(b: BookingStops): string[] {
  if (!b.alongTheWay || !b.boardingPoint) return [];
  const p = b.boardingPoint;
  const at = time(p.estimatedAt);
  const lines = ['Olish: ' + p.name + ', ' + p.meetingPoint + (at ? ' · taxminan ' + at : '')];
  if (b.alightingPoint) {
    lines.push('Tushirish: ' + b.alightingPoint.name + ', ' + b.alightingPoint.meetingPoint);
  }
  if (b.partDistanceM) lines.push('Uning yo‘li: ' + distance(b.partDistanceM));
  return lines;
}
