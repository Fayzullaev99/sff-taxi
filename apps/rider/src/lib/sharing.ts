/**
 * Wave 4 on the rider's side (pure, unit-tested): shared rides ("Hamroh bilan"), the
 * number of people, a woman driver, fixed route prices between towns, the start code and
 * the deposit of a ride booked for later. Every field may be missing (an older API): the
 * helpers then say nothing and the order goes out as before.
 */
import type {
  FareMode,
  LatLng,
  PaymentMethod,
  PoolCar,
  Quote,
  RideClass,
  RideOption,
  RouteFare,
  SeatLayout,
} from '../api/types';
import { t } from '../i18n/dictionary';
import { formatDay, formatMinutes, formatMoney, formatNumber, tashkentDay } from './format';
import { distanceM } from './ride-state';

/** One in front, at most two in the back (docs/shared-rides.md §1). */
export const MAX_PASSENGERS = 3;

const minutes = (s: number) => formatMinutes(Math.max(1, Math.ceil(s / 60)));

/** At most 3 people (the quote's own limit when it says a lower one), at least 1. */
export function clampPassengers(
  n: number,
  quote?: Pick<Quote, 'seats'> | null,
  rideClass?: RideClass,
): number {
  // a minivan carries up to 6 (the quote says per class); any other car the seating rule
  const max =
    rideClass === 'minivan'
      ? (quote?.seats?.byClass?.minivan ?? 6)
      : Math.min(MAX_PASSENGERS, quote?.seats?.max ?? MAX_PASSENGERS);
  return Math.max(1, Math.min(max, Math.round(n)));
}

/** Shared rides and route seats are sold in these classes only. */
export const POOL_CLASSES: readonly RideClass[] = ['economy', 'comfort'];

/** Free seats of a car by place: the front one and the back ones. */
export function freeSeats(car: SeatLayout): { front: number; rear: number } {
  const frontSeats = Math.min(1, car.capacity);
  const front = Math.max(0, frontSeats - car.front);
  const rear = Math.max(0, car.capacity - frontSeats - car.rear);
  return { front, rear };
}

/** The seats of a car in order (front, then back), taken or free: drawn as seat icons. */
export function seatMap(car: SeatLayout): { place: 'front' | 'rear'; taken: boolean }[] {
  const seats: { place: 'front' | 'rear'; taken: boolean }[] = [];
  const frontSeats = Math.min(1, car.capacity);
  for (let i = 0; i < frontSeats; i++) seats.push({ place: 'front', taken: i < car.front });
  for (let i = 0; i < car.capacity - frontSeats; i++) {
    seats.push({ place: 'rear', taken: i < car.rear });
  }
  return seats;
}

/** "ichida 1 kishi, 2 bo‘sh joy (oldinda 1 · orqada 1), ~3 daq" */
export function poolCarText(car: PoolCar): string {
  const free = freeSeats(car);
  const where = [
    free.front ? t('order.sharing.frontSeats', { count: free.front }) : null,
    free.rear ? t('order.sharing.rearSeats', { count: free.rear }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const people =
    car.inCar > 0 ? t('order.sharing.inCar', { count: car.inCar }) : t('order.sharing.emptyCar');
  const freeText = t('order.sharing.freeSeats', { count: car.free });
  const seats =
    car.free > 0
      ? where
        ? t('order.sharing.seatsWhere', { seats: freeText, where })
        : freeText
      : t('order.sharing.noSeats');
  return t('order.sharing.poolCar', { people, seats, eta: minutes(car.etaS) });
}

/** The line over the cars already going the rider's way (only cars with room for them). */
export function poolCarsHeadline(cars: readonly PoolCar[], passengers: number): string {
  return cars.some((c) => c.free >= passengers)
    ? t('order.sharing.carOnWay')
    : t('order.sharing.noCarOnWay');
}

/** The cars worth showing: room for everyone ordering, nearest first, three at most. */
export function poolCarsFor(cars: readonly PoolCar[] | undefined, passengers: number): PoolCar[] {
  return (cars ?? [])
    .filter((c) => c.free >= passengers)
    .sort((a, b) => a.etaS - b.etaS)
    .slice(0, 3);
}

export function shareToggleText(discountPercent: number): string {
  return discountPercent > 0
    ? t('order.sharing.toggleDiscount', { percent: discountPercent })
    : t('order.sharing.toggle');
}

/** The price a shared ride may come down to (the full discount): "~8 500 so‘mgacha". */
export function sharedFloor(total: number, discountPercent: number): number {
  return Math.max(0, total - Math.floor((total * discountPercent) / 100));
}

/** Free women drivers near the pickup, in words; null when the quote says nothing. */
export function womenDriversText(
  drivers: { cars: number; etaS: number | null } | null | undefined,
): string | null {
  if (!drivers) return null;
  if (drivers.cars <= 0 || drivers.etaS === null) {
    return t('order.sharing.noWomenNear');
  }
  return t('order.sharing.womenNear', { count: drivers.cars, eta: minutes(drivers.etaS) });
}

/** The route's prices for a class: a seat (per person) and/or the whole car. */
export function routePrices(
  quote: Pick<Quote, 'route'> | null | undefined,
  rideClass: RideClass,
): { seat: number | null; car: number | null } | null {
  const p = quote?.route?.prices?.[rideClass];
  if (!p) return null;
  const seat = typeof p.seat === 'number' && p.seat > 0 ? p.seat : null;
  const car = typeof p.car === 'number' && p.car > 0 ? p.car : null;
  return seat === null && car === null ? null : { seat, car };
}

const roundUp100 = (n: number) => Math.ceil(n / 100) * 100;

/** A seat order's price, as the API computes it: seat × people plus options, up to 100. */
export function seatTotal(
  seat: number,
  passengers: number,
  options: Partial<Record<RideOption, number>> | undefined,
): number {
  const extras = Object.values(options ?? {}).reduce((s, v) => s + (v ?? 0), 0);
  return roundUp100(seat * passengers + extras);
}

export interface RideChoices {
  passengers: number;
  shareable: boolean;
  womenOnly: boolean;
  fareMode: FareMode;
  paymentMethod: PaymentMethod;
}

/**
 * What the order sends, made consistent with the quote: a seat only where the route has a
 * seat price (it is a shared ride), sharing only where offered and always in cash, a
 * woman driver only where offered, 1–3 people. Older APIs (no fields) get the plain order.
 */
export function orderChoices(
  choices: RideChoices,
  quote: Pick<Quote, 'pool' | 'womenOnly' | 'route' | 'seats'>,
  rideClass: RideClass,
): RideChoices {
  const prices = routePrices(quote, rideClass);
  const poolClass = POOL_CLASSES.includes(rideClass);
  const fareMode: FareMode =
    choices.fareMode === 'seat' && prices?.seat && poolClass ? 'seat' : 'car';
  const shareable =
    fareMode === 'seat' || (choices.shareable && poolClass && quote.pool?.available === true);
  return {
    passengers: clampPassengers(choices.passengers, quote, rideClass),
    shareable,
    womenOnly: choices.womenOnly && quote.womenOnly?.available === true,
    fareMode,
    paymentMethod: shareable ? 'cash' : choices.paymentMethod,
  };
}

/** "4 8 1 2": the start code spaced for reading it aloud; null without one. */
export function pinDigits(pin: string | null | undefined): string | null {
  if (!pin || !/^\d{3,8}$/.test(pin)) return null;
  return pin.split('').join(' ');
}

/** "Mashinada 2 kishi · 1 bo‘sh joy" */
export function occupancyText(
  car: { inCar: number; free: number } | null | undefined,
): string | null {
  if (!car) return null;
  const free =
    car.free > 0
      ? t('order.sharing.freeSeats', { count: car.free })
      : t('order.sharing.noFreeSeats');
  return t('order.sharing.occupancy', { count: car.inCar, free });
}

/** The shared-ride discount line's name, in the app's language. */
export function poolDiscountLabel(): string {
  return t('order.sharing.discountLabel');
}

/**
 * A ride's price with the shared discount: what was quoted (struck through when lower
 * now), what the rider pays, the discount; the deposit paid in advance and the cash left.
 */
export function ridePrice(fare: {
  quoted: number;
  poolDiscount?: number;
  pays?: number;
  deposit?: number;
}): { quoted: number; pays: number; discount: number; deposit: number; cashLeft: number } {
  const discount = Math.max(0, fare.poolDiscount ?? 0);
  const pays = fare.pays ?? fare.quoted - discount;
  const deposit = Math.max(0, fare.deposit ?? 0);
  return { quoted: fare.quoted, pays, discount, deposit, cashLeft: Math.max(0, pays - deposit) };
}

export function discountLine(discount: number): string {
  return `${poolDiscountLabel()} −${formatMoney(discount)}`;
}

/** Town-to-town chips on the map: routes from the town the rider is in (~12 km). */
const ROUTE_FROM_M = 12_000;

export interface RouteChip {
  key: string;
  label: string;
  to: { lat: number; lng: number; name: string };
  /** A seat price exists: the order screen starts in seat mode. */
  seat: boolean;
}

/** "Yangiyer → Guliston · 10 000/kishi" (or the whole car's price). */
export function routeChipLabel(r: Pick<RouteFare, 'from' | 'to' | 'seatPrice' | 'carPrice'>) {
  const price =
    r.seatPrice && r.seatPrice > 0
      ? t('order.route.perPerson', { price: formatNumber(r.seatPrice) })
      : r.carPrice && r.carPrice > 0
        ? formatMoney(r.carPrice)
        : null;
  return `${r.from.name} → ${r.to.name}${price ? ` · ${price}` : ''}`;
}

/**
 * Economy routes that start in the rider's town (the pickup within ~12 km of its point),
 * nearest town first, one per destination, with a price, at most `max`.
 */
export function routeChips(
  routes: readonly RouteFare[] | undefined,
  pickup: LatLng | null,
  max = 3,
): RouteChip[] {
  if (!pickup || !routes?.length) return [];
  const seen = new Set<string>();
  return routes
    .filter((r) => r.class === 'economy' && r.isActive !== false)
    .filter((r) => (r.seatPrice ?? 0) > 0 || (r.carPrice ?? 0) > 0)
    .map((r) => ({ r, away: distanceM(pickup, r.from) }))
    .filter((x) => x.away <= ROUTE_FROM_M && distanceM(pickup, x.r.to) > ROUTE_FROM_M / 5)
    .sort((a, b) => a.away - b.away)
    .filter(({ r }) => {
      if (seen.has(r.to.slug)) return false;
      seen.add(r.to.slug);
      return true;
    })
    .slice(0, max)
    .map(({ r }) => ({
      key: r.id,
      label: routeChipLabel(r),
      to: { lat: r.to.lat, lng: r.to.lng, name: r.to.name },
      seat: (r.seatPrice ?? 0) > 0,
    }));
}

export type Gender = 'female' | 'male';

/** The declared gender in words, in the app's language. */
export function genderLabel(gender: Gender): string {
  return gender === 'female' ? t('common.gender.female') : t('common.gender.male');
}

/**
 * The gender names as a table, read in the app's language at access time (getters), for
 * screens that index it: `GENDER_LABELS[gender]`. New code calls `genderLabel`.
 */
export const GENDER_LABELS: Readonly<Record<Gender, string>> = {
  get female() {
    return genderLabel('female');
  },
  get male() {
    return genderLabel('male');
  },
};

/**
 * Whether the declared gender can be changed now, and if not the message saying when
 * (the API allows a change once per 30 days).
 */
export function genderLock(
  lockedUntil: string | null | undefined,
  now: Date,
): { locked: boolean; text: string | null } {
  if (!lockedUntil) return { locked: false, text: null };
  const until = new Date(lockedUntil);
  if (!Number.isFinite(until.getTime()) || until.getTime() <= now.getTime()) {
    return { locked: false, text: null };
  }
  return {
    locked: true,
    text: t('order.gender.lock', { day: formatDay(tashkentDay(until)) }),
  };
}

/**
 * A ride for later waiting for its deposit (not the whole fare, as a card ride): the
 * amount to pay now and the cash left for the driver; null for an ordinary card ride.
 */
export function depositPayment(ride: {
  payment: { amount: number } | null;
  fare: { quoted: number; poolDiscount?: number; pays?: number; deposit?: number };
}): { amount: number; cashLeft: number } | null {
  const deposit = ride.fare.deposit ?? 0;
  if (deposit <= 0) return null;
  const amount = ride.payment?.amount ?? deposit;
  const pays = ride.fare.pays ?? ride.fare.quoted - (ride.fare.poolDiscount ?? 0);
  return { amount, cashLeft: Math.max(0, pays - amount) };
}
