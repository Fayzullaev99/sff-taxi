import { z } from 'zod';
import { distanceM, roundUp100 } from './distance.js';
import { distanceToPolygonM, type Point, type PolygonRings } from './geo.js';
import { tashkentClock } from './hours.js';

/**
 * Fares (docs/architecture.md, market analysis §6.3). A fare is computed once, when the
 * rider asks for a quote, and never changes afterwards except for paid waiting: there is
 * no surge. In the city the price comes from fixed distance bands; the part of the route
 * outside the city polygon (suburbs, villages) is charged per km; long rides between towns
 * are charged per km for the whole car, with a per-seat share shown for reference.
 */

export const RIDE_CLASSES = ['economy', 'comfort'] as const;
export type RideClass = (typeof RIDE_CLASSES)[number];
export const RIDE_OPTIONS = ['child_seat', 'luggage', 'pets', 'ac'] as const;
export type RideOption = (typeof RIDE_OPTIONS)[number];
export type RideKind = 'city' | 'intercity';

const soum = z.number().int().min(0).max(10_000_000);
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

const Band = z.object({
  /** The band covers road distances up to and including this many metres. */
  up_to_m: z.number().int().min(100).max(100_000),
  price: soum,
});

export const ClassTariff = z.object({
  bands: z
    .array(Band)
    .min(1)
    .max(10)
    .refine(
      (b) =>
        b.every((x, i) => i === 0 || (x.up_to_m > b[i - 1]!.up_to_m && x.price >= b[i - 1]!.price)),
      'Bantlar masofa bo‘yicha o‘sib borishi, narx kamaymasligi kerak',
    ),
  /** In the city beyond the last band: per started kilometre. */
  beyond_per_km: soum,
  /** The part of the route outside the city polygon (suburbs, villages): per started km. */
  outside_per_km: soum,
  /** Intercity, whole car: per started kilometre of the road distance ... */
  intercity_per_km: soum,
  /** ... but at least this much. */
  intercity_min: soum,
});
export type ClassTariff = z.infer<typeof ClassTariff>;

export const Tariff = z.object({
  classes: z.object({ economy: ClassTariff, comfort: ClassTariff }),
  /** A fixed add-on at night (Tashkent time), never a multiplier that changes with demand. */
  night: z.object({ percent: z.number().int().min(0).max(100), from: HHMM, to: HHMM }),
  /** After the driver arrives: free minutes, then per started minute. */
  waiting: z.object({ free_minutes: z.number().int().min(0).max(30), per_minute: soum }),
  /** Flat prices of ride options; 0 = free but still requires a matching car. */
  options: z.object({ child_seat: soum, luggage: soum, pets: soum, ac: soum }),
  /** Seat share of an intercity whole-car fare, and the front seat's extra. */
  seats: z.object({
    share_percent: z.number().int().min(1).max(100),
    front_extra_percent: z.number().int().min(0).max(100),
  }),
  /** Rides with a road distance of at least this many km are intercity. */
  intercity_from_km: z.number().int().min(5).max(500),
  /** How far outside an active city's boundary a ride may still start (villages). */
  service_radius_km: z.number().int().min(0).max(100),
  /** Charged when the rider cancels after the driver arrived and free waiting ran out. */
  cancellation_fee: soum,
});
export type Tariff = z.infer<typeof Tariff>;

/** The launch tariff for Guliston: market analysis §6.3 (Yandex Start caps for comparison). */
export const DEFAULT_TARIFF: Tariff = {
  classes: {
    economy: {
      bands: [
        { up_to_m: 2000, price: 5000 },
        { up_to_m: 4000, price: 7000 },
        { up_to_m: 7000, price: 10_000 },
      ],
      beyond_per_km: 900,
      outside_per_km: 1500,
      intercity_per_km: 1700,
      intercity_min: 25_000,
    },
    // about +25%, like Yandex Comfort over Start
    comfort: {
      bands: [
        { up_to_m: 2000, price: 6300 },
        { up_to_m: 4000, price: 8800 },
        { up_to_m: 7000, price: 12_500 },
      ],
      beyond_per_km: 1100,
      outside_per_km: 1900,
      intercity_per_km: 2100,
      intercity_min: 31_000,
    },
  },
  night: { percent: 20, from: '23:00', to: '06:00' },
  waiting: { free_minutes: 2, per_minute: 500 },
  options: { child_seat: 2000, luggage: 2000, pets: 3000, ac: 0 },
  seats: { share_percent: 30, front_extra_percent: 10 },
  intercity_from_km: 20,
  service_radius_km: 15,
  cancellation_fee: 3000,
};

export interface FareInput {
  pickup: Point;
  dropoff: Point;
  /** Road distance from the router (or its estimate). */
  roadM: number;
  /** The active city the ride belongs to. */
  boundary: PolygonRings;
  rideClass: RideClass;
  options: readonly RideOption[];
  /** When the rider orders: decides the night add-on. */
  at: Date;
}

export interface Fare {
  kind: RideKind;
  rideClass: RideClass;
  distanceM: number;
  /** City rides: road metres inside and outside the city polygon. */
  insideM: number;
  outsideM: number;
  /** Band or per-km price of the distance. */
  base: number;
  /** Of which: the suburb (outside the polygon) part. */
  outside: number;
  night: number;
  options: Partial<Record<RideOption, number>>;
  total: number;
  /** Intercity only: what one seat would cost (rear, front). */
  seat: { rear: number; front: number } | null;
  /** A fixed route price (between towns) instead of the tariff's distance price. */
  fixed?: FixedPrice | null;
}

export interface FixedPrice {
  routeFareId: string;
  /** car: the whole car; seat: per person in a shared car. */
  mode: 'car' | 'seat';
  /** The route's price of the whole car, or of one seat. */
  price: number;
  /** People paying a seat each (seat mode). */
  passengers: number;
}

/**
 * A fixed route's fare: the route's price (per seat × people, or the whole car) plus the
 * options, never a night add-on (fixed means fixed). The distance parts stay for the record.
 */
export function fixedFare(fare: Fare, fixed: FixedPrice): Fare {
  const base = fixed.mode === 'seat' ? fixed.price * fixed.passengers : fixed.price;
  const options: Partial<Record<RideOption, number>> = { ...fare.options };
  const optionsTotal = Object.values(options).reduce((s, v) => s + v, 0);
  return {
    ...fare,
    base,
    outside: 0,
    night: 0,
    options,
    total: roundUp100(base + optionsTotal),
    seat: null,
    fixed,
  };
}

function minuteOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

/** Whether `at` falls in the night window (which may run past midnight). */
export function isNight(at: Date, night: Tariff['night']): boolean {
  const { minute } = tashkentClock(at);
  const from = minuteOf(night.from);
  const to = minuteOf(night.to);
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** Price of `metres` inside the city: the first band that covers it, then per started km. */
export function bandPrice(metres: number, t: ClassTariff): number {
  const band = t.bands.find((b) => metres <= b.up_to_m);
  if (band) return band.price;
  const last = t.bands.at(-1)!;
  return last.price + Math.ceil((metres - last.up_to_m) / 1000) * t.beyond_per_km;
}

export function rideKind(roadM: number, tariff: Tariff): RideKind {
  return roadM >= tariff.intercity_from_km * 1000 ? 'intercity' : 'city';
}

/**
 * Splits a city ride's road distance into the parts inside and outside the city polygon.
 * The straight-line distance of each end from the boundary, stretched by the route's own
 * detour ratio, is the outside part (a village 3 km out adds ~3 road km).
 */
export function splitInsideOutside(
  input: Pick<FareInput, 'pickup' | 'dropoff' | 'roadM' | 'boundary'>,
) {
  const straight = distanceM(
    input.pickup.lat,
    input.pickup.lng,
    input.dropoff.lat,
    input.dropoff.lng,
  );
  const ratio = straight > 50 ? Math.min(3, Math.max(1, input.roadM / straight)) : 1;
  const outsideStraight =
    distanceToPolygonM(input.pickup, input.boundary) +
    distanceToPolygonM(input.dropoff, input.boundary);
  const outsideM = Math.min(input.roadM, Math.round(outsideStraight * ratio));
  return { insideM: input.roadM - outsideM, outsideM };
}

export function computeFare(input: FareInput, tariff: Tariff): Fare {
  const t = tariff.classes[input.rideClass];
  const kind = rideKind(input.roadM, tariff);
  let insideM = input.roadM;
  let outsideM = 0;
  let base: number;
  let outside = 0;
  if (kind === 'intercity') {
    base = Math.max(t.intercity_min, Math.ceil(input.roadM / 1000) * t.intercity_per_km);
  } else {
    ({ insideM, outsideM } = splitInsideOutside(input));
    outside = outsideM > 0 ? Math.ceil(outsideM / 1000) * t.outside_per_km : 0;
    base = bandPrice(insideM, t) + outside;
  }
  const night = isNight(input.at, tariff.night)
    ? Math.round((base * tariff.night.percent) / 100)
    : 0;
  const options: Partial<Record<RideOption, number>> = {};
  for (const o of new Set(input.options)) options[o] = tariff.options[o];
  const optionsTotal = Object.values(options).reduce((s, v) => s + v, 0);
  const total = roundUp100(base + night + optionsTotal);
  const rear = roundUp100((total * tariff.seats.share_percent) / 100);
  return {
    kind,
    rideClass: input.rideClass,
    distanceM: input.roadM,
    insideM,
    outsideM,
    base,
    outside,
    night,
    options,
    total,
    seat:
      kind === 'intercity'
        ? { rear, front: roundUp100((rear * (100 + tariff.seats.front_extra_percent)) / 100) }
        : null,
  };
}

/** Paid waiting: per started minute once the free minutes after arrival ran out. */
export function waitingFee(arrivedAt: Date, startedAt: Date, tariff: Tariff): number {
  const seconds =
    (startedAt.getTime() - arrivedAt.getTime()) / 1000 - tariff.waiting.free_minutes * 60;
  return seconds > 0 ? Math.ceil(seconds / 60) * tariff.waiting.per_minute : 0;
}

/** Whether the free waiting after the driver's arrival is over. */
export function freeWaitingOver(arrivedAt: Date, now: Date, tariff: Tariff): boolean {
  return now.getTime() - arrivedAt.getTime() >= tariff.waiting.free_minutes * 60_000;
}
