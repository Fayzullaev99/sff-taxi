import { isApiError } from './api-client';
import type { RideAction } from './ride-flow';

/**
 * Shared rides on the driver's side (docs/shared-rides.md): the seating rule, the pool
 * settings on home, offer badges, the start code. Every field is optional on the wire, so
 * an older API simply shows nothing new. No React Native imports: unit-tested under Node.
 */

/** The hard seating rule: one passenger in front, never more than two in the back. */
export const FRONT_SEATS = 1;
export const REAR_SEATS_MAX = 2;
export const MAX_PASSENGERS = FRONT_SEATS + REAR_SEATS_MAX;

export interface Seats {
  occupied: number;
  capacity: number;
  front: number;
  rear: number;
  free: number;
}

/** How `occupied` people sit (front first), as the API computes it. */
export function seatLayout(occupied: number, registeredSeats = 4): Seats {
  const capacity = Math.max(0, Math.min(MAX_PASSENGERS, Math.floor(registeredSeats)));
  const n = Math.max(0, Math.min(Math.floor(occupied), capacity));
  const front = Math.min(n, FRONT_SEATS);
  return { occupied: n, capacity, front, rear: n - front, free: capacity - n };
}

/** "Oldinda 1/1 · orqada 1/2 · 1 ta bo‘sh". */
export function seatsText(s: Seats): string {
  const rearCap = Math.max(0, Math.min(REAR_SEATS_MAX, s.capacity - FRONT_SEATS));
  const free = s.free > 0 ? `${s.free} ta bo‘sh` : 'bo‘sh joy yo‘q';
  return `Oldinda ${s.front}/${FRONT_SEATS} · orqada ${s.rear}/${rearCap} · ${free}`;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export interface Destination {
  lat: number;
  lng: number;
  address: string | null;
}

export interface PoolSettings {
  enabled: boolean;
  extraPassengers: number;
  destination: Destination | null;
  seats: Seats;
}

/** The pool settings from `driver/me`, or null when the API does not have them yet. */
export function poolSettings(
  me: { pool?: unknown; vehicle?: { seats?: number } | null } | null | undefined,
): PoolSettings | null {
  const p = me?.pool;
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const extra = Math.max(0, Math.min(MAX_PASSENGERS, Math.floor(num(o.extraPassengers, 0))));
  const d = o.destination as Record<string, unknown> | null | undefined;
  const destination =
    d && typeof d.lat === 'number' && typeof d.lng === 'number'
      ? { lat: d.lat, lng: d.lng, address: typeof d.address === 'string' ? d.address : null }
      : null;
  const s = o.seats as Record<string, unknown> | undefined;
  const fallback = seatLayout(extra, me?.vehicle?.seats ?? 4);
  const seats: Seats = s
    ? {
        occupied: num(s.occupied, fallback.occupied),
        capacity: num(s.capacity, fallback.capacity),
        front: num(s.front, fallback.front),
        rear: num(s.rear, fallback.rear),
        free: num(s.free, fallback.free),
      }
    : fallback;
  return { enabled: o.enabled === true, extraPassengers: extra, destination, seats };
}

/**
 * The people-in-the-car stepper: the next value, and whether a destination must be chosen
 * first (the API refuses people without the app unless the driver says where they go).
 */
export function extraPassengersStep(
  current: number,
  delta: number,
  hasDestination: boolean,
  capacity: number = MAX_PASSENGERS,
): { value: number; needsDestination: boolean } {
  const value = Math.max(0, Math.min(Math.min(capacity, MAX_PASSENGERS), current + delta));
  return { value, needsDestination: value > 0 && !hasDestination };
}

/** A short name for a place: the first part of its address ("Yangiyer, Sirdaryo" → "Yangiyer"). */
export function shortPlace(address: string | null | undefined): string {
  const first = address?.split(',')[0]?.trim();
  return first || 'belgilangan nuqta';
}

/** The destination filter chip. */
export function destinationChip(dest: Destination | null): string | null {
  return dest ? `Faqat yo‘lingizdagi buyurtmalar: → ${shortPlace(dest.address)}` : null;
}

export type BadgeTone = 'brand' | 'success' | 'warning' | 'info' | 'neutral';
export interface Badge {
  label: string;
  tone: BadgeTone;
}

/** What makes an offer different: people, sharing, a woman driver asked for, seat pricing. */
export function offerBadges(ride: {
  passengers?: number;
  shareable?: boolean;
  womenOnly?: boolean;
  fareMode?: string;
}): Badge[] {
  const out: Badge[] = [];
  const n = Math.max(1, Math.floor(num(ride.passengers, 1)));
  if (ride.fareMode === 'seat') out.push({ label: `O‘rindiq, ${n} kishi`, tone: 'info' });
  else if (n > 1) out.push({ label: `${n} kishi`, tone: 'info' });
  if (ride.shareable) out.push({ label: 'Hamroh', tone: 'brand' });
  if (ride.womenOnly) out.push({ label: 'Ayol haydovchi so‘ralgan', tone: 'warning' });
  return out;
}

/** "Yo‘lingizda: +4 daq aylanish" for an offer on the car's way. */
export function alongLine(detourS: number | null | undefined): string {
  const min = Math.ceil(Math.max(0, num(detourS, 0)) / 60);
  return min > 0 ? `Yo‘lingizda: +${min} daq aylanish` : 'Yo‘lingizda: aylanishsiz';
}

export interface PlanStopLike {
  rideId: string | null;
  type: 'pickup' | 'dropoff' | 'destination';
  passengers?: number;
}

/**
 * The stop order an accepted offer would give, as short lines: the new rider's stops are
 * "Yangi yo‘lovchi", riders already in hand by name, the driver's own destination last.
 */
export function alongStopLines(
  stops: readonly PlanStopLike[],
  newRideId: string,
  names: ReadonlyMap<string, string | null> = new Map(),
): { key: string; text: string; isNew: boolean }[] {
  return stops.map((s, i) => {
    const isNew = s.rideId !== null && s.rideId.toLowerCase() === newRideId.toLowerCase();
    let who: string;
    if (s.type === 'destination') who = 'Sizning manzilingiz';
    else if (isNew) who = 'Yangi yo‘lovchi';
    else who = (s.rideId && names.get(s.rideId)) || 'Yo‘lovchi';
    const what = s.type === 'pickup' ? 'olish' : s.type === 'dropoff' ? 'tushirish' : '';
    return {
      key: `${i}:${s.rideId ?? 'dest'}:${s.type}`,
      text: what ? `${who} — ${what}` : who,
      isNew,
    };
  });
}

export interface PoolStopLike {
  rideId: string;
  number?: number;
  type: 'pickup' | 'dropoff';
  lat: number;
  lng: number;
  place?: { address: string | null; landmark: string | null } | null;
  riderName?: string | null;
  passengers?: number;
  status: string;
}

export interface RidePoolLike {
  riders?: number;
  occupancy?: Partial<Seats> & { inCar?: number };
  stops: PoolStopLike[];
}

/** The stops ahead of a car with several riders, or null (one rider, or an older API). */
export function ridePool(ride: { pool?: unknown } | null | undefined): RidePoolLike | null {
  const p = ride?.pool as { stops?: unknown } | null | undefined;
  if (!p || !Array.isArray(p.stops) || p.stops.length === 0) return null;
  return p as RidePoolLike;
}

/** What the big button does at a stop of this ride, or null when nothing is due there. */
export function stopAction(type: 'pickup' | 'dropoff', status: string): RideAction | null {
  if (type === 'pickup' && status === 'driver_assigned') return 'arrive';
  if (type === 'pickup' && status === 'driver_arrived') return 'start';
  if (type === 'dropoff' && status === 'in_progress') return 'complete';
  return null;
}

/** The ids of every ride in the car (for per-rider cash and phones). */
export function poolRideIds(pool: RidePoolLike | null, currentId: string): string[] {
  const ids = [currentId, ...(pool?.stops.map((s) => s.rideId) ?? [])];
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

/** A start code as typed: digits only, at most 4. */
export function pinInput(text: string): string {
  return text.replace(/\D/g, '').slice(0, 4);
}

export function isPin(text: string): boolean {
  return /^\d{4}$/.test(text);
}

/** The start refused because of the code (400 "Kod noto‘g‘ri" / "4 xonali kodni so‘rang"). */
export function isPinError(error: unknown): boolean {
  return isApiError(error, 400) && /kod/i.test(error.message);
}

/**
 * What the start-code keypad says about a refused start, or null for other errors: a wrong
 * code, or too many wrong codes (the API pauses the start for a while, 429 with its text).
 */
export function pinErrorText(error: unknown): string | null {
  if (isPinError(error)) return 'Kod noto‘g‘ri. Yo‘lovchidan qayta so‘rang.';
  if (isApiError(error, 429)) {
    return /kod/i.test(error.message)
      ? error.message
      : 'Kod ko‘p marta noto‘g‘ri kiritildi. Birozdan so‘ng qayta urinib ko‘ring.';
  }
  return null;
}

/** The message for a refused preferences change (400/403/409 come with Uzbek text). */
export function preferencesError(error: unknown): string {
  if (isApiError(error, 0)) return 'Internet yo‘q: sozlama saqlanmadi. Qayta urinib ko‘ring.';
  if (isApiError(error) && [400, 403, 409, 422].includes(error.status)) return error.message;
  return 'Sozlama saqlanmadi. Birozdan so‘ng qayta urinib ko‘ring.';
}

/** The recent destinations list after picking `item`: newest first, no near-duplicates. */
export function pushRecent(
  list: readonly Destination[],
  item: Destination,
  max = 5,
): Destination[] {
  const same = (a: Destination) =>
    Math.abs(a.lat - item.lat) < 0.0005 && Math.abs(a.lng - item.lng) < 0.0005;
  return [item, ...list.filter((d) => !same(d))].slice(0, max);
}

/** A stored recent list, ignoring anything malformed. */
export function parseRecent(raw: unknown): Destination[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (d): d is Destination =>
        !!d &&
        typeof (d as Destination).lat === 'number' &&
        typeof (d as Destination).lng === 'number',
    )
    .map((d) => ({
      lat: d.lat,
      lng: d.lng,
      address: typeof d.address === 'string' ? d.address : null,
    }))
    .slice(0, 5);
}
