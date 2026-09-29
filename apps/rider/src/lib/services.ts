/**
 * Cargo ("Yuk tashish") and delivery ("Yetkazib berish") on the rider's side (pure,
 * unit-tested): names, class labels, load and parcel checks, the recipient, and how a
 * ride's screen speaks about a cargo car or a parcel. Taxi rides stay as they were.
 */
import type { AnyRideClass, CargoClass, CargoClassRules, RideService } from '../api/types';
import { formatMoney, normalizePhone } from './format';
import type { RidePhase } from './ride-state';

export const SERVICE_LABELS: Record<RideService, string> = {
  taxi: 'Taksi',
  cargo: 'Yuk',
  delivery: 'Yetkazish',
};

export const SERVICE_NAMES: Record<RideService, string> = {
  taxi: 'Taksi',
  cargo: 'Yuk tashish',
  delivery: 'Yetkazib berish',
};

export const CARGO_CLASSES: readonly CargoClass[] = ['cargo_s', 'cargo_m'];

export const CARGO_CLASS_LABELS: Record<CargoClass, string> = {
  cargo_s: 'Kichik',
  cargo_m: 'O‘rta',
};

export const CARGO_CLASS_NOTES: Record<CargoClass, string> = {
  cargo_s: 'Damas, Labo',
  cargo_m: 'Gazel, Porter, Isuzu',
};

const TAXI_CLASS_LABELS: Record<string, string> = { economy: 'Ekonom', comfort: 'Komfort' };

export function isCargoClass(c: string): c is CargoClass {
  return c === 'cargo_s' || c === 'cargo_m';
}

/** Any ride's class in words ("Ekonom", "Kichik yuk mashinasi"). */
export function classLabel(c: AnyRideClass | string): string {
  if (isCargoClass(c)) return `${CARGO_CLASS_LABELS[c]} yuk mashinasi`;
  return TAXI_CLASS_LABELS[c] ?? c;
}

/** A service the app may offer: on unless the API's /config switches it off. */
export function serviceOn(
  service: RideService,
  features: Record<string, unknown> | null | undefined,
): boolean {
  if (service === 'taxi') return true;
  return features?.[service] !== false;
}

/**
 * Reads a weight typed by hand: whole kilograms 1..max. `null` for an empty field (the
 * weight is optional), an error text for anything else.
 */
export function parseWeight(
  text: string,
  maxKg: number,
): { kg: number | null; error: string | null } {
  const t = text.trim().replace(',', '.');
  if (!t) return { kg: null, error: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { kg: null, error: 'Og‘irlikni kilogrammda yozing' };
  const kg = Math.ceil(Number(t));
  if (kg < 1) return { kg: null, error: 'Kamida 1 kg' };
  if (kg > maxKg) return { kg, error: `Ko‘pi bilan ${maxKg} kg` };
  return { kg, error: null };
}

/** Whether a load fits a cargo class (no weight given: yes). */
export function cargoFits(rules: CargoClassRules | undefined, weightKg: number | null): boolean {
  if (!rules) return true;
  return weightKg === null || weightKg <= rules.maxPayloadKg;
}

/** The smallest class that takes the load (the cheaper one first). */
export function cargoClassFor(
  classes: Partial<Record<CargoClass, CargoClassRules>> | undefined,
  weightKg: number | null,
  preferred: CargoClass,
): CargoClass {
  if (cargoFits(classes?.[preferred], weightKg)) return preferred;
  return CARGO_CLASSES.find((c) => cargoFits(classes?.[c], weightKg)) ?? preferred;
}

/** "700 kg gacha · 10 km va 20 daq kiradi, keyin 1 500 so‘m/km" */
export function cargoLimitsText(r: CargoClassRules): string {
  return `${r.maxPayloadKg} kg gacha · ${r.includedKm} km va ${r.includedMinutes} daq narxga kiradi, keyin ${formatMoney(r.perKm)}/km`;
}

export function loadersText(loaders: number, loaderPrice: number): string {
  if (loaders <= 0) return 'Yukchisiz: yukni o‘zingiz ortasiz';
  return `${loaders} ta yukchi · har biri ${formatMoney(loaderPrice)}`;
}

/** The recipient of a parcel: a name and a valid Uzbek phone (normalised), else errors. */
export function checkRecipient(
  name: string,
  phone: string,
): {
  ok: boolean;
  name: string;
  phone: string | null;
  nameError: string | null;
  phoneError: string | null;
} {
  const n = name.trim();
  const p = normalizePhone(phone);
  const nameError = n.length === 0 ? 'Qabul qiluvchining ismini yozing' : null;
  const phoneError = !phone.trim()
    ? 'Qabul qiluvchining telefonini yozing'
    : p === null
      ? 'Telefon raqami noto‘g‘ri: +998 XX XXX XX XX'
      : null;
  return { ok: !nameError && !phoneError, name: n, phone: p, nameError, phoneError };
}

const CARGO_TITLES: Partial<Record<RidePhase, string>> = {
  searching: 'Yuk mashinasi qidirilmoqda',
  assigned: 'Yuk mashinasi yo‘lda',
  arrived: 'Yuk mashinasi yetib keldi',
  on_trip: 'Yuk yo‘lda',
  completed: 'Yuk yetkazildi',
  no_driver: 'Bo‘sh yuk mashinasi topilmadi',
};

const DELIVERY_TITLES: Partial<Record<RidePhase, string>> = {
  searching: 'Haydovchi qidirilmoqda',
  assigned: 'Haydovchi posilkani olishga kelmoqda',
  arrived: 'Haydovchi posilkani kutmoqda',
  on_trip: 'Posilka yo‘lda',
  completed: 'Posilka yetkazildi',
};

/** The ride screen's title for a cargo ride or a delivery (taxi: the default one). */
export function serviceTitle(
  service: RideService | undefined,
  phase: RidePhase,
  fallback: string,
): string {
  if (service === 'cargo') return CARGO_TITLES[phase] ?? fallback;
  if (service === 'delivery') return DELIVERY_TITLES[phase] ?? fallback;
  return fallback;
}

/** One line about the load or the parcel for the ride screen and the receipt. */
export function loadLine(ride: {
  service?: RideService;
  cargo?: {
    loaders: number;
    riderRides: boolean;
    description: string | null;
    weightKg: number | null;
  } | null;
  delivery?: {
    parcel: { description: string | null; weightKg: number | null } | null;
    recipientName: string | null;
  } | null;
}): string | null {
  if (ride.service === 'cargo' && ride.cargo) {
    const c = ride.cargo;
    return (
      [
        c.description,
        c.weightKg ? `${c.weightKg} kg` : null,
        c.loaders > 0 ? `${c.loaders} ta yukchi` : null,
        c.riderRides ? 'o‘zingiz kabinada' : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Yuk'
    );
  }
  if (ride.service === 'delivery' && ride.delivery) {
    const p = ride.delivery.parcel;
    const parcel =
      [p?.description, p?.weightKg ? `${p.weightKg} kg` : null].filter(Boolean).join(', ') ||
      'Posilka';
    return ride.delivery.recipientName ? `${parcel} → ${ride.delivery.recipientName}` : parcel;
  }
  return null;
}
