/**
 * Cargo ("Yuk tashish") and delivery ("Yetkazib berish") on the rider's side (pure,
 * unit-tested): names, class labels, load and parcel checks, the recipient, and how a
 * ride's screen speaks about a cargo car or a parcel. Taxi rides stay as they were.
 */
import type { AnyRideClass, CargoClass, CargoClassRules, RideService } from '../api/types';
import { t, type TKey } from '../i18n/dictionary';
import { formatMoney, normalizePhone } from './format';
import type { RidePhase } from './ride-state';

const SERVICE_LABEL_KEYS: Record<RideService, TKey> = {
  taxi: 'common.services.taxi',
  cargo: 'common.services.cargoShort',
  delivery: 'common.services.deliveryShort',
};

const SERVICE_NAME_KEYS: Record<RideService, TKey> = {
  taxi: 'common.services.taxi',
  cargo: 'common.services.cargo',
  delivery: 'common.services.delivery',
};

/** A service's short name (the map's switcher): "Taksi", "Yuk", "Yetkazish". */
export function serviceLabel(service: RideService): string {
  return t(SERVICE_LABEL_KEYS[service]);
}

/** A service's full name: "Taksi", "Yuk tashish", "Yetkazib berish". */
export function serviceName(service: RideService): string {
  return t(SERVICE_NAME_KEYS[service]);
}

/**
 * The service names as tables, read in the app's language at access time (getters), for
 * screens that index them: `SERVICE_NAMES[ride.service]`. New code calls the functions.
 */
export const SERVICE_LABELS: Readonly<Record<RideService, string>> = {
  get taxi() {
    return serviceLabel('taxi');
  },
  get cargo() {
    return serviceLabel('cargo');
  },
  get delivery() {
    return serviceLabel('delivery');
  },
};

export const SERVICE_NAMES: Readonly<Record<RideService, string>> = {
  get taxi() {
    return serviceName('taxi');
  },
  get cargo() {
    return serviceName('cargo');
  },
  get delivery() {
    return serviceName('delivery');
  },
};

export const CARGO_CLASSES: readonly CargoClass[] = ['cargo_s', 'cargo_m'];

const CARGO_CLASS_LABEL_KEYS: Record<CargoClass, TKey> = {
  cargo_s: 'common.classes.cargo_s',
  cargo_m: 'common.classes.cargo_m',
};

const CARGO_CLASS_NOTE_KEYS: Record<CargoClass, TKey> = {
  cargo_s: 'order.cargo.notes.cargo_s',
  cargo_m: 'order.cargo.notes.cargo_m',
};

/** A cargo class's size in words: "Kichik", "O‘rta". */
export function cargoClassLabel(c: CargoClass): string {
  return t(CARGO_CLASS_LABEL_KEYS[c]);
}

/** Car examples of a cargo class: "Damas, Labo". */
export function cargoClassNote(c: CargoClass): string {
  return t(CARGO_CLASS_NOTE_KEYS[c]);
}

const TAXI_CLASS_KEYS: Record<string, TKey> = {
  economy: 'common.classes.economy',
  comfort: 'common.classes.comfort',
  minivan: 'common.classes.minivan',
  business: 'common.classes.business',
};

export function isCargoClass(c: string): c is CargoClass {
  return c === 'cargo_s' || c === 'cargo_m';
}

/** Any ride's class in words ("Ekonom", "Kichik yuk mashinasi"). */
export function classLabel(c: AnyRideClass | string): string {
  if (isCargoClass(c)) return t('common.classes.cargoCar', { name: cargoClassLabel(c) });
  const key = TAXI_CLASS_KEYS[c];
  return key ? t(key) : c;
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
  const typed = text.trim().replace(',', '.');
  if (!typed) return { kg: null, error: null };
  if (!/^\d+(\.\d+)?$/.test(typed)) return { kg: null, error: t('order.cargo.weightNotNumber') };
  const kg = Math.ceil(Number(typed));
  if (kg < 1) return { kg: null, error: t('order.cargo.weightMin') };
  if (kg > maxKg) return { kg, error: t('order.cargo.weightMax', { kg: maxKg }) };
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
  return t('order.cargo.limits', {
    kg: r.maxPayloadKg,
    km: r.includedKm,
    minutes: r.includedMinutes,
    perKm: formatMoney(r.perKm),
  });
}

export function loadersText(loaders: number, loaderPrice: number): string {
  if (loaders <= 0) return t('order.cargo.noLoaders');
  return t('order.cargo.loadersEach', { count: loaders, price: formatMoney(loaderPrice) });
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
  const nameError = n.length === 0 ? t('order.parcel.recipientNameRequired') : null;
  const phoneError = !phone.trim()
    ? t('order.parcel.recipientPhoneRequired')
    : p === null
      ? t('order.phone.invalid')
      : null;
  return { ok: !nameError && !phoneError, name: n, phone: p, nameError, phoneError };
}

const CARGO_TITLE_KEYS: Partial<Record<RidePhase, TKey>> = {
  searching: 'order.cargo.titles.searching',
  assigned: 'order.cargo.titles.assigned',
  arrived: 'order.cargo.titles.arrived',
  on_trip: 'order.cargo.titles.on_trip',
  completed: 'order.cargo.titles.completed',
  no_driver: 'order.cargo.titles.no_driver',
};

const DELIVERY_TITLE_KEYS: Partial<Record<RidePhase, TKey>> = {
  searching: 'order.parcel.titles.searching',
  assigned: 'order.parcel.titles.assigned',
  arrived: 'order.parcel.titles.arrived',
  on_trip: 'order.parcel.titles.on_trip',
  completed: 'order.parcel.titles.completed',
};

/** The ride screen's title for a cargo ride or a delivery (taxi: the default one). */
export function serviceTitle(
  service: RideService | undefined,
  phase: RidePhase,
  fallback: string,
): string {
  const key =
    service === 'cargo'
      ? CARGO_TITLE_KEYS[phase]
      : service === 'delivery'
        ? DELIVERY_TITLE_KEYS[phase]
        : undefined;
  return key ? t(key) : fallback;
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
        c.weightKg ? `${c.weightKg} ${t('common.units.kg')}` : null,
        c.loaders > 0 ? t('order.cargo.loadersCount', { count: c.loaders }) : null,
        c.riderRides ? t('order.cargo.riderInCab') : null,
      ]
        .filter(Boolean)
        .join(' · ') || t('common.services.cargoShort')
    );
  }
  if (ride.service === 'delivery' && ride.delivery) {
    const p = ride.delivery.parcel;
    const parcel =
      [p?.description, p?.weightKg ? `${p.weightKg} ${t('common.units.kg')}` : null]
        .filter(Boolean)
        .join(', ') || t('order.parcel.title');
    return ride.delivery.recipientName ? `${parcel} → ${ride.delivery.recipientName}` : parcel;
  }
  return null;
}

/** "Taksi sizdan 180 m" on the way to the pickup, in the words of the service. */
export function carAwayLabel(service: RideService | undefined): string {
  if (service === 'cargo') return t('order.away.cargo');
  if (service === 'delivery') return t('order.away.delivery');
  return t('order.away.taxi');
}
