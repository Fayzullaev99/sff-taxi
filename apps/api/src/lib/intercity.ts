import { distanceM, roundUp100 } from './distance.js';
import { MAX_PASSENGERS, REAR_SEATS_MAX } from './pool.js';
import type { RideClass, Tariff } from './tariff.js';

/**
 * Seat prices of the intercity trip board (market analysis §6.3 "Inter-town / intercity per
 * seat"): a seat is a share of the whole-car intercity fare, the front seat costs extra.
 * An operator may fix a route's seat prices instead (Guliston-Tashkent 70 000 / 80 000);
 * a driver publishing a trip may move the rear price within a band (±15%).
 */
export interface SeatPrices {
  rear: number;
  front: number;
}

/** The whole car between two towns by the tariff: per started km, at least the minimum. */
export function wholeCarFare(roadM: number, tariff: Tariff, rideClass: RideClass): number {
  const t = tariff.classes[rideClass];
  return Math.max(t.intercity_min, Math.ceil(roadM / 1000) * t.intercity_per_km);
}

/**
 * The reference seat prices of a route: the operators' route price if there is one (for
 * economy; comfort pays the tariff's comfort/economy ratio on top), else the tariff's share.
 */
export function referenceSeatPrices(
  roadM: number,
  tariff: Tariff,
  rideClass: RideClass,
  routePrice: SeatPrices | null = null,
): SeatPrices {
  if (routePrice) {
    if (rideClass === 'economy') return routePrice;
    const ratio = tariff.classes.comfort.intercity_per_km / tariff.classes.economy.intercity_per_km;
    return {
      rear: roundUp100(routePrice.rear * ratio),
      front: roundUp100(routePrice.front * ratio),
    };
  }
  const rear = roundUp100(
    (wholeCarFare(roadM, tariff, rideClass) * tariff.seats.share_percent) / 100,
  );
  return { rear, front: frontPrice(rear, tariff.seats.front_extra_percent) };
}

export function frontPrice(rear: number, extraPercent: number): number {
  return roundUp100((rear * (100 + extraPercent)) / 100);
}

/** The rear-seat prices a driver may ask: the reference ± the band, in whole 100 so'm. */
export function priceBand(reference: number, bandPercent: number): { min: number; max: number } {
  return {
    min: Math.ceil((reference * (100 - bandPercent)) / 100 / 100) * 100,
    max: Math.floor((reference * (100 + bandPercent)) / 100 / 100) * 100,
  };
}

/**
 * The driver's own seat prices: the rear price they ask (within the band), the front seat
 * keeping the reference's front/rear proportion.
 */
export function driverSeatPrices(reference: SeatPrices, askedRear: number): SeatPrices {
  if (askedRear === reference.rear) return reference;
  return { rear: askedRear, front: roundUp100((askedRear * reference.front) / reference.rear) };
}

/** What a booking of `seats` seats costs, one of them the front seat when `front`. */
export function bookingPrice(seats: number, front: boolean, prices: SeatPrices): number {
  return front ? (seats - 1) * prices.rear + prices.front : seats * prices.rear;
}

// Seating rule ------------------------------------------------------------------------------

/** One passenger in front, never more than two in the back (src/lib/pool.ts). */
export const MAX_TRIP_SEATS = MAX_PASSENGERS;
export const MAX_REAR_SEATS = REAR_SEATS_MAX;

/** Why a trip may not offer these seats (the rider-facing message), or null. */
export function seatingError(seats: number, frontSeat: boolean): string | null {
  if (seats > MAX_TRIP_SEATS) {
    return 'Mashinaga ko‘pi bilan 3 yo‘lovchi olinadi: oldinda 1, orqada 2';
  }
  if (seats - (frontSeat ? 1 : 0) > MAX_REAR_SEATS) {
    return 'Orqa o‘rindiqqa 2 tadan ortiq yo‘lovchi olinmaydi';
  }
  return null;
}

// Along the way ------------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

/** A rider's part of a trip must be at least this share of it (and pays at least this share). */
export const ALONG_MIN_SHARE = 0.3;

/**
 * Whether a rider going `from` -> `to` fits a trip `start` -> `end` "along the way": going
 * through the rider's towns in order adds at most `maxDetourKm` to the trip (straight lines:
 * roads between the towns bend too, Guliston -> Sirdaryo -> Toshkent is the road), the rider
 * travels in the trip's direction, and the rider's part is at least 30% of the trip.
 * Returns the rider's share of the trip (0.3..1), or null.
 */
export function alongTheWayShare(
  start: LatLng,
  end: LatLng,
  from: LatLng,
  to: LatLng,
  maxDetourKm: number,
): number | null {
  const d = (a: LatLng, b: LatLng) => distanceM(a.lat, a.lng, b.lat, b.lng);
  const trip = d(start, end);
  const part = d(from, to);
  if (trip <= 0 || part <= 0) return null;
  const detour = d(start, from) + part + d(to, end) - trip;
  if (detour > maxDetourKm * 1000) return null;
  // the rider's direction along the trip's (projections on the start -> end line)
  if (progress(start, end, to) <= progress(start, end, from)) return null;
  const share = Math.min(1, part / trip);
  return share >= ALONG_MIN_SHARE ? share : null;
}

/** How far along start -> end the point lies, 0 at the start, 1 at the end (flat projection). */
function progress(start: LatLng, end: LatLng, p: LatLng): number {
  const k = Math.cos((start.lat * Math.PI) / 180);
  const ex = (end.lng - start.lng) * k;
  const ey = end.lat - start.lat;
  const px = (p.lng - start.lng) * k;
  const py = p.lat - start.lat;
  return (px * ex + py * ey) / (ex * ex + ey * ey);
}

/**
 * A seat price for part of a trip: in proportion, rounded up to whole 1 000 so'm, at least
 * 30% of the seat price and never more than it.
 */
export function partSeatPrice(price: number, share: number): number {
  const part = Math.ceil((price * share) / 1000) * 1000;
  const floor = roundUp100(price * ALONG_MIN_SHARE);
  return Math.min(price, Math.max(floor, part));
}

export function partSeatPrices(prices: SeatPrices, share: number): SeatPrices {
  if (share >= 1) return prices;
  return { rear: partSeatPrice(prices.rear, share), front: partSeatPrice(prices.front, share) };
}

// Where a rider along the way gets in and out ------------------------------------------------

/**
 * How far along the trip `start` -> `end` a town lies, 0..1: its distance from the start over
 * the way through it (straight lines; the towns a trip passes lie on its road).
 */
export function fractionAlong(start: LatLng, end: LatLng, p: LatLng): number {
  const d = (a: LatLng, b: LatLng) => distanceM(a.lat, a.lng, b.lat, b.lng);
  const before = d(start, p);
  const after = d(p, end);
  if (before + after <= 0) return 0;
  return Math.min(1, Math.max(0, before / (before + after)));
}

const FIVE_MINUTES_MS = 5 * 60_000;

/**
 * A rider's part of a trip: when the car passes their town (departure + that share of the
 * trip's driving time, rounded to 5 minutes; an estimate, "taxminan") and how far they ride
 * (their share of the trip's road metres, rounded to 100 m). The trip's own ends: departure
 * and the whole distance.
 */
export function alongStops(
  trip: { start: LatLng; end: LatLng; departureAt: Date; distanceM: number; durationS: number },
  pickup: LatLng,
  dropoff: LatLng,
): { boardingAt: Date; partDistanceM: number } {
  const from = fractionAlong(trip.start, trip.end, pickup);
  const to = fractionAlong(trip.start, trip.end, dropoff);
  const at = trip.departureAt.getTime() + from * trip.durationS * 1000;
  return {
    boardingAt: new Date(Math.round(at / FIVE_MINUTES_MS) * FIVE_MINUTES_MS),
    partDistanceM: Math.round((Math.max(0, to - from) * trip.distanceM) / 100) * 100,
  };
}
