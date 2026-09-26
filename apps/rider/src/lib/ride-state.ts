/**
 * Which screen a ride shows (pure, unit-tested). The API's statuses map to phases:
 * searching -> assigned -> arrived -> on trip -> completed, or cancelled; a ride the
 * system cancelled after searching in vain is "no driver" (retry or phone the office).
 */
import type { LatLng, RideActor, RideStatus } from '../api/types';

export type RidePhase =
  'searching' | 'assigned' | 'arrived' | 'on_trip' | 'completed' | 'cancelled' | 'no_driver';

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
}

export function ridePhase(ride: RideLike): RidePhase {
  switch (ride.status) {
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
      return ride.cancelledBy === 'system' ? 'no_driver' : 'cancelled';
  }
}

const TITLES: Record<RidePhase, string> = {
  searching: 'Haydovchi qidirilmoqda',
  assigned: 'Haydovchi yo‘lda',
  arrived: 'Haydovchi sizni kutmoqda',
  on_trip: 'Safardasiz',
  completed: 'Safar yakunlandi',
  cancelled: 'Buyurtma bekor qilindi',
  no_driver: 'Bo‘sh mashina topilmadi',
};

export function rideScreen(ride: RideLike): RideScreen {
  const phase = ridePhase(ride);
  const final = phase === 'completed' || phase === 'cancelled' || phase === 'no_driver';
  const withDriver = phase === 'assigned' || phase === 'arrived' || phase === 'on_trip';
  const cancellable = phase === 'searching' || phase === 'assigned' || phase === 'arrived';
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
export function cancelledText(ride: {
  cancelledBy: RideActor | null;
  cancelReason: string | null;
}): string {
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
      return 'Yaqin atrofda bo‘sh haydovchi topilmadi. Birozdan so‘ng qayta urinib ko‘ring yoki operatorga qo‘ng‘iroq qiling.';
    default:
      return 'Buyurtma bekor qilindi.';
  }
}

/** Open rides: the app goes straight to their screen on start. */
export function isOpenStatus(status: RideStatus): boolean {
  return status !== 'completed' && status !== 'cancelled';
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
 * Minutes for the car to reach a point. The API gives no live ETA to riders (only the
 * push when the driver accepts), so this estimates from the car's position: straight
 * line × detour at city speed. At least 1 minute; null without a position.
 */
export function etaMinutes(car: LatLng | null, target: LatLng): number | null {
  if (!car) return null;
  const km = (distanceM(car, target) * DETOUR) / 1000;
  return Math.max(1, Math.round((km / CITY_KMH) * 60));
}
