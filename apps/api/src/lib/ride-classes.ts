import { MAX_PASSENGERS } from './pool.js';
import type { RideClass } from './tariff.js';

/**
 * Taxi classes and which cars take which rides (docs/architecture.md §6). Each class has its
 * own tariff block and an operator's on/off switch (src/lib/tariff.ts); this file is what
 * the class means for people and cars:
 *
 * - Ekonom: any taxi car; Komfort: <= 5 years, AC; Biznes: premium sedans/SUVs <= 3 years,
 *   AC, a driver rated 4.8+; Miniven: 6-7 passenger seats, <= 8 years, AC, up to 6 people
 *   and big luggage (the car rules: src/lib/driver-rules.ts).
 * - A ride of class X goes to cars of class X. A car of a higher class may also take lower
 *   classes' rides ("upgrade down", like Yandex): a comfort car economy rides (on by
 *   default, as before this rule existed), a business car comfort and economy rides, a
 *   minivan economy and comfort rides (both off by default: the driver opts in).
 */

export interface ClassInfo {
  /** The rider's name of the class. */
  label: string;
  /** One line under the name: what the car is. */
  description: string;
  /** Car examples (the order screen's second line). */
  examples: string;
  /** People one ride of the class may carry. */
  maxPassengers: number;
}

export const CLASS_INFO: Record<RideClass, ClassInfo> = {
  economy: {
    label: 'Ekonom',
    description: 'Arzon va tez: oddiy sedan',
    examples: 'Cobalt, Nexia 3, Gentra, Lacetti',
    maxPassengers: MAX_PASSENGERS,
  },
  comfort: {
    label: 'Komfort',
    description: 'Yangiroq mashina, konditsioner',
    examples: 'Gentra, Onix, Tracker, Monza',
    maxPassengers: MAX_PASSENGERS,
  },
  minivan: {
    label: 'Miniven',
    description: '6 kishigacha va katta yuk',
    examples: 'Orlando, Captiva 7, Kia Carnival',
    maxPassengers: 6,
  },
  business: {
    label: 'Biznes',
    description: 'Premium mashina, tajribali haydovchi',
    examples: 'Malibu 2, Tracker 2 Premier, Kia K5, Sonata',
    maxPassengers: MAX_PASSENGERS,
  },
};

/** The rider's label of a class (cargo classes and unknown values pass through). */
export function classLabel(rideClass: string): string {
  return (CLASS_INFO as Record<string, ClassInfo | undefined>)[rideClass]?.label ?? rideClass;
}

/**
 * Lower classes a car of each class is able to serve (when its driver takes them). Minivans
 * take economy and comfort: a newer car with AC and more room than either needs.
 */
export const LOWER_CLASSES: Record<RideClass, readonly RideClass[]> = {
  economy: [],
  comfort: ['economy'],
  business: ['comfort', 'economy'],
  minivan: ['comfort', 'economy'],
};

/** Car classes whose drivers take lower classes unless they turned it off. */
export const TAKES_LOWER_BY_DEFAULT: readonly RideClass[] = ['comfort'];

/** Whether a driver takes lower classes' rides: their own choice, else the class's default. */
export function takesLower(carClass: RideClass, choice: boolean | null): boolean {
  return choice ?? TAKES_LOWER_BY_DEFAULT.includes(carClass);
}

/** The ride classes a car gets offers of. */
export function rideClassesForCar(carClass: RideClass, choice: boolean | null): RideClass[] {
  return [carClass, ...(takesLower(carClass, choice) ? LOWER_CLASSES[carClass] : [])];
}

/** Whether a car of this class is able to serve the ride at all (an operator's assignment). */
export function carCanServe(carClass: RideClass, rideClass: RideClass): boolean {
  return carClass === rideClass || LOWER_CLASSES[carClass].includes(rideClass);
}

/** Car classes that are able to serve a ride of the class (own class first). */
export function carClassesForRide(rideClass: RideClass): RideClass[] {
  return (Object.keys(LOWER_CLASSES) as RideClass[]).filter((c) => carCanServe(c, rideClass));
}

/** Whether a car takes a ride of the class (offers): its class, or a lower one if it opted in. */
export function carTakes(carClass: RideClass, rideClass: RideClass, choice: boolean | null) {
  return rideClassesForCar(carClass, choice).includes(rideClass);
}

/** People one ride of the class may carry. */
export function maxPassengers(rideClass: RideClass): number {
  return CLASS_INFO[rideClass].maxPassengers;
}

/**
 * People a car may carry at once: a minivan its seats (at most 6), any other car the
 * seating rule's 3 (one in front, two in the back). The database trigger mirrors this.
 */
export function carCapacityFor(carClass: RideClass, seats: number): number {
  return Math.max(0, Math.min(seats, carClass === 'minivan' ? 6 : MAX_PASSENGERS));
}

/** Shared rides ("Hamroh bilan") and seats of fixed routes are sold in these classes only. */
export const POOL_CLASSES: readonly RideClass[] = ['economy', 'comfort'];
