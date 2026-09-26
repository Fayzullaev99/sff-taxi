import { roundUp100 } from './distance.js';
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
