/**
 * Which screen a ride shows (pure, unit-tested). The API's statuses map to phases:
 * (scheduled | awaiting payment ->) searching -> assigned -> arrived -> on trip ->
 * completed, or cancelled; a ride the system cancelled after searching in vain is
 * "no driver" (retry or phone the office), a card ride not paid in time "payment failed".
 */
import type {
  ClassAvailability,
  LatLng,
  RideActor,
  RidePaymentStatus,
  RideStatus,
} from '../api/types';
import { formatMinutes } from './format';

export type RidePhase =
  | 'scheduled'
  | 'awaiting_payment'
  | 'searching'
  | 'assigned'
  | 'arrived'
  | 'on_trip'
  | 'completed'
  | 'cancelled'
  | 'no_driver'
  | 'payment_failed';

export interface RideScreen {
  phase: RidePhase;
  title: string;
  /** Ride is over: no live updates, no map of the car. */
  final: boolean;
  /** The car's marker and the driver's card are shown. */
  showDriver: boolean;
  /** Where the map frames the car: towards the pickup, or towards the destination. */
  heading: 'pickup' | 'dropoff' | null;
  canCancel: boolean;
  /** Share-trip link: while the ride is open and a car is on the way or driving. */
  canShare: boolean;
  /** SOS: once a driver is involved, and during the trip. */
  canSos: boolean;
}

interface RideLike {
  status: RideStatus;
  cancelledBy: RideActor | null;
  canCancel?: boolean;
  paymentStatus?: RidePaymentStatus;
  scheduledFor?: string | null;
  cancelledAt?: string | null;
}

/**
 * A scheduled ride the system cancelled well before its time was never searched for (the
 * rider was on another ride when its search was due, 15 minutes before); a search that
 * found nobody ends 10 minutes after it started, i.e. at most 5 minutes before the time.
 */
function cancelledBeforeSearch(ride: RideLike): boolean {
  if (!ride.scheduledFor || !ride.cancelledAt) return false;
  return new Date(ride.scheduledFor).getTime() - new Date(ride.cancelledAt).getTime() > 10 * 60_000;
}

export function ridePhase(ride: RideLike): RidePhase {
  switch (ride.status) {
    case 'scheduled':
      return 'scheduled';
    case 'awaiting_payment':
      return 'awaiting_payment';
    case 'searching':
      return 'searching';
    case 'driver_assigned':
      return 'assigned';
    case 'driver_arrived':
      return 'arrived';
    case 'in_progress':
      return 'on_trip';
    case 'completed':
      return 'completed';
    case 'cancelled':
      if (ride.paymentStatus === 'failed') return 'payment_failed';
      if (ride.cancelledBy !== 'system' || cancelledBeforeSearch(ride)) return 'cancelled';
      return 'no_driver';
  }
}

const TITLES: Record<RidePhase, string> = {
  scheduled: 'Oldindan buyurtma',
  awaiting_payment: 'To‘lov kutilmoqda',
  searching: 'Haydovchi qidirilmoqda',
  assigned: 'Haydovchi yo‘lda',
  arrived: 'Haydovchi sizni kutmoqda',
  on_trip: 'Safardasiz',
  completed: 'Safar yakunlandi',
  cancelled: 'Buyurtma bekor qilindi',
  no_driver: 'Bo‘sh mashina topilmadi',
  payment_failed: 'To‘lov amalga oshmadi',
};

export function rideScreen(ride: RideLike): RideScreen {
  const phase = ridePhase(ride);
  const final =
    phase === 'completed' ||
    phase === 'cancelled' ||
    phase === 'no_driver' ||
    phase === 'payment_failed';
  const withDriver = phase === 'assigned' || phase === 'arrived' || phase === 'on_trip';
  const cancellable =
    phase === 'scheduled' ||
    phase === 'awaiting_payment' ||
    phase === 'searching' ||
    phase === 'assigned' ||
    phase === 'arrived';
  return {
    phase,
    title: TITLES[phase],
    final,
    showDriver: withDriver,
    heading: phase === 'assigned' ? 'pickup' : phase === 'on_trip' ? 'dropoff' : null,
    // the API has the last word (canCancel); the phase decides the button otherwise
    canCancel: cancellable && ride.canCancel !== false,
    canShare: withDriver,
    canSos: withDriver,
  };
}

/** Who ended a ride, in the rider's words. */
export function cancelledText(ride: RideLike & { cancelReason: string | null }): string {
  const phase = ridePhase(ride);
  if (phase === 'payment_failed') {
    return 'To‘lov 10 daqiqa ichida amalga oshirilmadi, buyurtma bekor qilindi. Kartadan pul yechilmadi.';
  }
  if (phase === 'no_driver') {
    return 'Yaqin atrofda bo‘sh haydovchi topilmadi. Birozdan so‘ng qayta urinib ko‘ring yoki operatorga qo‘ng‘iroq qiling.';
  }
  switch (ride.cancelledBy) {
    case 'rider':
      return 'Siz buyurtmani bekor qildingiz.';
    case 'driver':
      return ride.cancelReason
        ? `Haydovchi buyurtmani yopdi: ${ride.cancelReason}.`
        : 'Haydovchi buyurtmani yopdi.';
    case 'operator':
      return ride.cancelReason
        ? `Operator buyurtmani bekor qildi: ${ride.cancelReason}.`
        : 'Operator buyurtmani bekor qildi.';
    case 'system':
      return ride.cancelReason
        ? `Buyurtma bekor qilindi: ${ride.cancelReason}.`
        : 'Buyurtma bekor qilindi.';
    default:
      return 'Buyurtma bekor qilindi.';
  }
}

/** Open rides: the app goes straight to their screen on start. */
export function isOpenStatus(status: RideStatus): boolean {
  return status !== 'completed' && status !== 'cancelled' && status !== 'scheduled';
}

/** Straight-line metres between two points (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Road detour over the straight line, as the API's fallback uses (ROUTER_DETOUR_FACTOR). */
const DETOUR = 1.35;
/** Average speed in a small city with stops. */
const CITY_KMH = 25;

/**
 * Minutes for the car to reach a point, estimated from its position: straight line ×
 * detour at city speed. At least 1 minute; null without a position. Only a fallback: the
 * API's road ETA is used whenever there is one (see pickupEta).
 */
export function etaMinutes(car: LatLng | null, target: LatLng): number | null {
  if (!car) return null;
  const km = (distanceM(car, target) * DETOUR) / 1000;
  return Math.max(1, Math.round((km / CITY_KMH) * 60));
}

/** A road ETA from the API: seconds as of a moment. */
export interface EtaReading {
  etaS: number;
  at: string;
}

/** The newer of two ETA readings (the fetched ride's, the stream's). */
export function newerEta(a: EtaReading | null, b: EtaReading | null): EtaReading | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(b.at).getTime() >= new Date(a.at).getTime() ? b : a;
}

/** An API ETA older than this (no new fixes: the stream is down) gives way to the estimate. */
const ETA_STALE_MS = 2 * 60_000;

/**
 * Minutes until the car is at the pickup: the API's road ETA (recomputed every ~15 s with
 * the car's position), counted down since it was computed; the straight-line estimate
 * only when there is no fresh one.
 */
export function pickupEta(
  api: EtaReading | null,
  car: LatLng | null,
  pickup: LatLng,
  now: Date,
): { minutes: number; source: 'api' | 'estimate' } | null {
  if (api) {
    const elapsedMs = Math.max(0, now.getTime() - new Date(api.at).getTime());
    if (elapsedMs <= ETA_STALE_MS || !car) {
      const leftS = Math.max(0, api.etaS - elapsedMs / 1000);
      return { minutes: Math.max(1, Math.ceil(leftS / 60)), source: 'api' };
    }
  }
  const estimate = etaMinutes(car, pickup);
  return estimate === null ? null : { minutes: estimate, source: 'estimate' };
}

/** The footer's line: the nearest free car of the class, by road ("Eng yaqin mashina ~4 daq"). */
export function availabilityText(a: ClassAvailability | null | undefined): string | null {
  if (!a) return null;
  if (a.etaS === null || a.cars === 0) return 'Yaqinda bo‘sh mashina yo‘q';
  return `Eng yaqin mashina ~${formatMinutes(Math.max(1, Math.ceil(a.etaS / 60)))}`;
}

/**
 * The same on a class card, short enough for one line at a large font (1.3): "Mashina ~4 daq",
 * "Mashina yo‘q"; the footer keeps the full sentence.
 */
export function availabilityShort(a: ClassAvailability | null | undefined): string | null {
  if (!a) return null;
  if (a.etaS === null || a.cars === 0) return 'Mashina yo‘q';
  return 'Mashina ~' + formatMinutes(Math.max(1, Math.ceil(a.etaS / 60)));
}
