/**
 * The rules a driver works under, as the API publishes them: `GET /v1/driver/config`
 * (commission, caps, passes, minimum balance, waiting and no-show rules, the trip board's
 * rules, decline and cancel reasons, top-up limits, support) and the public `GET /v1/config`
 * (support contacts, minimum app versions, store links, feature flags, card providers).
 *
 * The mapping is tolerant: a missing or malformed field keeps the launch default, so an
 * older or newer API never breaks the money screen. Defaults are only shown until the
 * config loads (or when the phone is offline on first start).
 */

export type CardProvider = 'payme' | 'click';

export interface BillingRules {
  /** 0% platform commission on rides completed up to this Tashkent date (null: no promo). */
  promoUntil: string | null;
  commissionPercent: number;
  dailyCap: number;
  weeklyCap: number;
  intercityPercent: number;
  intercityTripCap: number;
  taxPercent: number;
  passDay: number;
  passWeek: number;
  minBalance: number;
}

export interface RideRules {
  offerTimeoutSeconds: number;
  broadcastTimeoutSeconds: number;
  noShowAfterMinutes: number;
  freeWaitingMinutes: number;
  waitingPerMinute: number;
  cancellationFee: number;
}

/** The intercity trip board's rules (`GET /v1/driver/config` → `intercity`). */
export interface IntercityRules {
  /** A departure is published (or moved) at least this far ahead. */
  publishMinMinutesAhead: number;
  /** … and at most this many days ahead. */
  publishMaxDaysAhead: number;
  /** One driver's departures must be this far apart. */
  tripSpacingHours: number;
  /** Boarding can be opened this long before departure. */
  boardingOpensMinutes: number;
  /** The seat price may differ from the reference by this much (the band itself comes with fares). */
  priceBandPercent: number;
  /** Riders cancel a booking free until this long before departure … */
  freeCancelMinutes: number;
  /** … later they owe this share of the seat price. */
  lateCancelFeePercent: number;
}

export interface Reason {
  code: string;
  label: string;
}

export interface Support {
  phone: string | null;
  telegram: string | null;
  officeAddress: string | null;
}

export interface DriverConfig {
  billing: BillingRules;
  rides: RideRules;
  intercity: IntercityRules;
  declineReasons: Reason[];
  cancelReasons: Reason[];
  topups: { min: number; max: number; providers: CardProvider[] };
  support: Support;
}

export interface StoreUrls {
  android: string | null;
  ios: string | null;
}

export interface PublicConfig {
  support: Support;
  /** The lowest driver app version the API still serves (null: not published). */
  minDriverVersion: string | null;
  /** Where the update screen sends the driver (null: the app's own Play Store link). */
  storeUrls: StoreUrls;
  features: {
    cardPayments: boolean;
    uploads: boolean;
    intercity: boolean;
    scheduledRides: boolean;
  };
  cardProviders: CardProvider[];
}

/** Launch defaults (API settings defaults; market analysis §6.3). */
export const DEFAULT_BILLING: BillingRules = {
  promoUntil: '2026-12-31',
  commissionPercent: 5,
  dailyCap: 10_000,
  weeklyCap: 55_000,
  intercityPercent: 5,
  intercityTripCap: 10_000,
  taxPercent: 1,
  passDay: 9_000,
  passWeek: 50_000,
  minBalance: -10_000,
};

export const DEFAULT_RIDE_RULES: RideRules = {
  offerTimeoutSeconds: 15,
  broadcastTimeoutSeconds: 30,
  noShowAfterMinutes: 5,
  freeWaitingMinutes: 2,
  waitingPerMinute: 500,
  cancellationFee: 3_000,
};

/** The API's settings defaults (`DEFAULT_INTERCITY`), until the config loads. */
export const DEFAULT_INTERCITY_RULES: IntercityRules = {
  publishMinMinutesAhead: 15,
  publishMaxDaysAhead: 7,
  tripSpacingHours: 2,
  boardingOpensMinutes: 60,
  priceBandPercent: 15,
  freeCancelMinutes: 60,
  lateCancelFeePercent: 30,
};

/** The API's DECLINE_REASONS (dispatch.module.ts), in its order. */
export const DEFAULT_DECLINE_REASONS: Reason[] = [
  { code: 'too_far', label: 'Juda uzoq' },
  { code: 'destination', label: 'Bu tomonga bormayman' },
  { code: 'rider_rating', label: 'Yo‘lovchi reytingi past' },
  { code: 'car_not_suitable', label: 'Avtomobil mos emas' },
  { code: 'break', label: 'Dam olyapman' },
  { code: 'other', label: 'Boshqa sabab' },
];

export const DEFAULT_CANCEL_REASONS: Reason[] = [
  { code: 'rider_no_show', label: 'Yo‘lovchi chiqmadi' },
  { code: 'car_problem', label: 'Avtomobil nosoz' },
  { code: 'cannot_reach', label: 'Manzilga yetib borolmayman' },
  { code: 'rider_asked', label: 'Yo‘lovchi bekor qilishni so‘radi' },
  { code: 'other', label: 'Boshqa sabab' },
];

export const DEFAULT_SUPPORT: Support = { phone: null, telegram: null, officeAddress: null };

export const DEFAULT_DRIVER_CONFIG: DriverConfig = {
  billing: DEFAULT_BILLING,
  rides: DEFAULT_RIDE_RULES,
  intercity: DEFAULT_INTERCITY_RULES,
  declineReasons: DEFAULT_DECLINE_REASONS,
  cancelReasons: DEFAULT_CANCEL_REASONS,
  topups: { min: 5_000, max: 5_000_000, providers: [] },
  support: DEFAULT_SUPPORT,
};

export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  support: DEFAULT_SUPPORT,
  minDriverVersion: null,
  storeUrls: { android: null, ios: null },
  features: { cardPayments: false, uploads: false, intercity: true, scheduledRides: true },
  cardProviders: [],
};

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** A store link (https, market://, itms-apps://), or null. */
function storeLink(v: unknown): string | null {
  const t = text(v);
  return t && /^(https?|market|itms-apps):\/\//i.test(t) ? t : null;
}

/** The update screen's link for this platform, or null (the app's own fallback). */
export function storeUrlFor(urls: StoreUrls, platform: string): string | null {
  if (platform === 'android') return urls.android;
  if (platform === 'ios') return urls.ios;
  return null;
}

function providers(v: unknown): CardProvider[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is CardProvider => p === 'payme' || p === 'click');
}

/** `{too_far: "Juda uzoq", …}` (or a list of `{code, label}`) → reasons; the defaults when empty. */
export function mapReasons(v: unknown, fallback: Reason[]): Reason[] {
  const out: Reason[] = [];
  if (Array.isArray(v)) {
    for (const item of v) {
      const o = obj(item);
      const code = text(o.code);
      const label = text(o.label);
      if (code && label) out.push({ code, label });
    }
  } else {
    for (const [code, label] of Object.entries(obj(v))) {
      const l = text(label);
      if (l) out.push({ code, label: l });
    }
  }
  return out.length ? out : fallback;
}

/** Support contacts; the build-time values (EXPO_PUBLIC_*) fill what the API leaves empty. */
export function mapSupport(v: unknown, fallback: Support = DEFAULT_SUPPORT): Support {
  const o = obj(v);
  return {
    phone: text(o.phone) ?? fallback.phone,
    telegram: text(o.telegram) ?? fallback.telegram,
    officeAddress: text(o.officeAddress) ?? fallback.officeAddress,
  };
}

/** `GET /v1/driver/config` → the app's rules. */
export function mapDriverConfig(
  raw: unknown,
  fallbackSupport: Support = DEFAULT_SUPPORT,
): DriverConfig {
  const r = obj(raw);
  const b = obj(r.billing);
  const passes = obj(b.passes);
  const rides = obj(r.rides);
  const topups = obj(r.topups);
  const ic = obj(r.intercity);
  const d = DEFAULT_DRIVER_CONFIG;
  const promo = b.promoUntil === null ? null : text(b.promoUntil);
  return {
    billing: {
      promoUntil:
        'promoUntil' in b
          ? promo && /^\d{4}-\d{2}-\d{2}$/.test(promo)
            ? promo
            : null
          : d.billing.promoUntil,
      commissionPercent: num(b.commissionPercent, d.billing.commissionPercent),
      dailyCap: num(b.dailyCap, d.billing.dailyCap),
      weeklyCap: num(b.weeklyCap, d.billing.weeklyCap),
      intercityPercent: num(b.intercityCommissionPercent, d.billing.intercityPercent),
      intercityTripCap: num(b.intercityTripCap, d.billing.intercityTripCap),
      taxPercent: num(b.taxPercent, d.billing.taxPercent),
      passDay: num(passes.day, d.billing.passDay),
      passWeek: num(passes.week, d.billing.passWeek),
      minBalance: num(b.minBalance, d.billing.minBalance),
    },
    rides: {
      offerTimeoutSeconds: num(rides.offerTimeoutSeconds, d.rides.offerTimeoutSeconds),
      broadcastTimeoutSeconds: num(rides.broadcastTimeoutSeconds, d.rides.broadcastTimeoutSeconds),
      noShowAfterMinutes: num(rides.noShowAfterMinutes, d.rides.noShowAfterMinutes),
      freeWaitingMinutes: num(rides.freeWaitingMinutes, d.rides.freeWaitingMinutes),
      waitingPerMinute: num(rides.waitingPerMinute, d.rides.waitingPerMinute),
      cancellationFee: num(rides.cancellationFee, d.rides.cancellationFee),
    },
    intercity: {
      publishMinMinutesAhead: num(ic.publishMinMinutesAhead, d.intercity.publishMinMinutesAhead),
      publishMaxDaysAhead: num(ic.publishMaxDaysAhead, d.intercity.publishMaxDaysAhead),
      tripSpacingHours: num(ic.tripSpacingHours, d.intercity.tripSpacingHours),
      boardingOpensMinutes: num(ic.boardingOpensMinutes, d.intercity.boardingOpensMinutes),
      priceBandPercent: num(ic.priceBandPercent, d.intercity.priceBandPercent),
      freeCancelMinutes: num(ic.freeCancelMinutes, d.intercity.freeCancelMinutes),
      lateCancelFeePercent: num(ic.lateCancelFeePercent, d.intercity.lateCancelFeePercent),
    },
    declineReasons: mapReasons(r.declineReasons, d.declineReasons),
    cancelReasons: mapReasons(r.cancelReasons, d.cancelReasons),
    topups: {
      min: num(topups.min, d.topups.min),
      max: num(topups.max, d.topups.max),
      providers: providers(topups.providers),
    },
    support: mapSupport(r.support, fallbackSupport),
  };
}

/** `GET /v1/config` → what the driver app needs from it. */
export function mapPublicConfig(
  raw: unknown,
  fallbackSupport: Support = DEFAULT_SUPPORT,
): PublicConfig {
  const r = obj(raw);
  const f = obj(r.features);
  const d = DEFAULT_PUBLIC_CONFIG.features;
  return {
    support: mapSupport(r.support, fallbackSupport),
    // null (the API's default): no forced update
    minDriverVersion: text(obj(r.minAppVersion).driver),
    storeUrls: {
      android: storeLink(obj(obj(r.storeUrls).driver).android),
      ios: storeLink(obj(obj(r.storeUrls).driver).ios),
    },
    features: {
      cardPayments: bool(f.cardPayments, d.cardPayments),
      uploads: bool(f.uploads, d.uploads),
      intercity: bool(f.intercity, d.intercity),
      scheduledRides: bool(f.scheduledRides, d.scheduledRides),
    },
    cardProviders: providers(r.cardProviders),
  };
}

/** Passes are sold when both prices are set and the commission they replace exists. */
export function passesOnSale(billing: BillingRules): boolean {
  return billing.passDay > 0 && billing.passWeek > 0 && billing.commissionPercent > 0;
}
