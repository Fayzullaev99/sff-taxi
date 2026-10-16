import { liveTable, t } from '../i18n/dictionary';
import { normalizePlate, plateProblem } from './plate';

/**
 * The driver application (Cabinet Resolution No. 200, cl. 10; API POST /v1/driver/application).
 * The form keeps what the driver typed as strings; `validateApplication` checks it with the
 * same rules as the API (apps/api src/lib/driver-rules.ts) so mistakes are explained on the
 * field before sending, and `toApplicationBody` builds the request.
 */

export const RULES = {
  minAge: 21,
  minExperienceYears: 3,
  maxVehicleAgeYears: 15,
  maxComfortAgeYears: 5,
  maxSeats: 4,
  /** Miniven: 6-7 passenger seats besides the driver, <= 8 years, AC. */
  minMinivanSeats: 6,
  maxMinivanSeats: 7,
  maxMinivanAgeYears: 8,
  /** Biznes: a premium model, <= 3 years, AC (and a 4.8 rating, checked by the API). */
  maxBusinessAgeYears: 3,
  /** A cargo car's cab seats besides the driver: Damas/Labo 1, Gazel/Porter/Isuzu 2. */
  maxCargoCabSeats: 2,
  /** Cargo cars (not passenger taxis): at most 25 years old. */
  maxCargoVehicleAgeYears: 25,
  /** Above this total (gross) mass a category C licence is needed. */
  maxCategoryBGrossKg: 3500,
  /** Up to this payload a cargo car serves small loads (cargo_s), above medium (cargo_m). */
  smallMaxPayloadKg: 800,
} as const;

/** Taxi classes and what each needs, as the application screen explains them. */
export const VEHICLE_CLASSES = ['economy', 'comfort', 'minivan', 'business'] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];
export const VEHICLE_CLASS_LABELS: Record<VehicleClass, string> = liveTable({
  economy: 'apply.vehicle.classes.economy',
  comfort: 'apply.vehicle.classes.comfort',
  minivan: 'apply.vehicle.classes.minivan',
  business: 'apply.vehicle.classes.business',
});

/** The short class names (in the current language) for the rule texts. */
const CLASS_NAMES: Record<VehicleClass, string> = liveTable({
  economy: 'common.classes.economy',
  comfort: 'common.classes.comfort',
  minivan: 'common.classes.minivan',
  business: 'common.classes.business',
});

/** The API's premium models for Biznes (apps/api src/lib/driver-rules.ts isBusinessModel). */
export function isBusinessModel(make: string, model: string): boolean {
  return (
    /\b(mercedes|benz|bmw|lexus|audi|genesis|volvo|zeekr|lixiang|li auto)\b/i.test(make) ||
    /\b(malibu|tracker|tahoe|traverse|equinox|k5|k8|k9|sonata|grandeur|santa ?fe|palisade|sorento|camry|han|seal|tang|song plus|tiggo 8|exeed|hongqi)\b/i.test(
      `${make} ${model}`,
    )
  );
}

/**
 * Why the car does not fit a taxi class (null: it fits): the class's age limit, AC, seats
 * (a minivan 6-7, any other car at most 4) and, for business, a premium model.
 */
export function classProblem(
  c: VehicleClass,
  car: { make: string; model: string; year: number; seats: number; features: string[] },
  today: string,
): string | null {
  const thisYear = Number(today.slice(0, 4));
  const age = thisYear - car.year;
  if (c === 'minivan') {
    if (car.seats < RULES.minMinivanSeats || car.seats > RULES.maxMinivanSeats) {
      return t('apply.vehicle.classProblem.minivanSeats', {
        min: RULES.minMinivanSeats,
        max: RULES.maxMinivanSeats,
      });
    }
  } else if (car.seats > RULES.maxSeats) {
    return t('apply.vehicle.classProblem.tooManySeats', { max: RULES.maxSeats });
  }
  if (c === 'economy') return null;
  const maxAge = {
    comfort: RULES.maxComfortAgeYears,
    minivan: RULES.maxMinivanAgeYears,
    business: RULES.maxBusinessAgeYears,
  }[c];
  const name = CLASS_NAMES[c];
  if (Number.isFinite(age) && age > maxAge) {
    return t('apply.vehicle.classProblem.tooOld', { class: name, maxAge });
  }
  if (!car.features.includes('ac')) {
    return t('apply.vehicle.classProblem.needsAc', { class: name });
  }
  if (c === 'business' && !isBusinessModel(car.make, car.model)) {
    return t('apply.vehicle.classProblem.needsPremium');
  }
  return null;
}

/**
 * The classes the car typed so far fits, in words under the class choice ("" until the year
 * and seats are typed). Operators confirm the class at the inspection.
 */
export function classFitText(f: ApplicationForm, today = tashkentToday()): string {
  const year = Number(f.year);
  const seats = Number(f.seats);
  if (!/^\d{4}$/.test(f.year.trim()) || !Number.isInteger(seats) || seats < 1) return '';
  const car = { make: f.make, model: f.model, year, seats, features: f.features };
  const fits = VEHICLE_CLASSES.filter((c) => classProblem(c, car, today) === null);
  if (!fits.length) return t('apply.vehicle.classFit.none');
  return t('apply.vehicle.classFit.fits', {
    classes: fits.map((c) => CLASS_NAMES[c]).join(', '),
  });
}

/** What the car works for: passenger rides and parcels, or cargo rides only. */
export type CarService = 'taxi' | 'cargo';

export const CARGO_BODIES = ['van', 'pickup', 'truck'] as const;
export type CargoBody = (typeof CARGO_BODIES)[number];
export const CARGO_BODY_LABELS: Record<CargoBody, string> = liveTable({
  van: 'apply.vehicle.bodies.van',
  pickup: 'apply.vehicle.bodies.pickup',
  truck: 'apply.vehicle.bodies.truck',
});

/** Common cargo cars with typical figures (the driver corrects them from the tech passport). */
export const CARGO_CARS = [
  // seats: the cab's besides the driver (a Damas has one next to the driver)
  { make: 'Chevrolet', model: 'Damas', body: 'van', payloadKg: 550, grossKg: 1400, seats: 1 },
  { make: 'Chevrolet', model: 'Labo', body: 'pickup', payloadKg: 550, grossKg: 1400, seats: 1 },
  { make: 'GAZ', model: 'Gazel', body: 'truck', payloadKg: 1500, grossKg: 3500, seats: 2 },
  { make: 'Hyundai', model: 'Porter', body: 'truck', payloadKg: 1000, grossKg: 2900, seats: 2 },
  { make: 'Isuzu', model: 'NLR', body: 'truck', payloadKg: 1500, grossKg: 3500, seats: 2 },
] as const;

/** Which cargo orders the car gets, by its payload. */
export function cargoClassText(payloadKg: number): string {
  return payloadKg <= RULES.smallMaxPayloadKg
    ? t('apply.vehicle.cargoOrders.small')
    : t('apply.vehicle.cargoOrders.medium');
}

export const LICENCE_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'BE', 'CE', 'DE'] as const;
export const VEHICLE_FEATURES = ['ac', 'child_seat', 'pets', 'big_trunk'] as const;
export type VehicleFeature = (typeof VEHICLE_FEATURES)[number];

export const FEATURE_LABELS: Record<VehicleFeature, string> = liveTable({
  ac: 'common.options.ac',
  child_seat: 'common.options.child_seat',
  pets: 'apply.vehicle.featureLabels.pets',
  big_trunk: 'apply.vehicle.featureLabels.big_trunk',
});

/**
 * The colour list (apps/api src/lib/vehicle-colour.ts): the form keeps the code, the API
 * stores it and names it in each rider's language. A car registered before the list may
 * carry text the list does not name: it stays selectable as it is.
 */
export const VEHICLE_COLOURS = [
  'white',
  'black',
  'silver',
  'grey',
  'blue',
  'dark_blue',
  'light_blue',
  'red',
  'dark_red',
  'green',
  'yellow',
  'orange',
  'brown',
  'beige',
  'purple',
  'gold',
] as const;
export type VehicleColour = (typeof VEHICLE_COLOURS)[number];
export const COLOUR_LABELS: Record<VehicleColour, string> = liveTable({
  white: 'apply.vehicle.colours.white',
  black: 'apply.vehicle.colours.black',
  silver: 'apply.vehicle.colours.silver',
  grey: 'apply.vehicle.colours.grey',
  blue: 'apply.vehicle.colours.blue',
  dark_blue: 'apply.vehicle.colours.dark_blue',
  light_blue: 'apply.vehicle.colours.light_blue',
  red: 'apply.vehicle.colours.red',
  dark_red: 'apply.vehicle.colours.dark_red',
  green: 'apply.vehicle.colours.green',
  yellow: 'apply.vehicle.colours.yellow',
  orange: 'apply.vehicle.colours.orange',
  brown: 'apply.vehicle.colours.brown',
  beige: 'apply.vehicle.colours.beige',
  purple: 'apply.vehicle.colours.purple',
  gold: 'apply.vehicle.colours.gold',
});

export function isVehicleColour(value: string): value is VehicleColour {
  return (VEHICLE_COLOURS as readonly string[]).includes(value);
}

/** The colour chips: the list, plus the car's own text when it is not one of the list. */
export function colourChoices(current: string): { value: string; label: string }[] {
  const list = VEHICLE_COLOURS.map((c) => ({ value: c, label: COLOUR_LABELS[c] }));
  const own = current.trim();
  return own && !isVehicleColour(own) ? [...list, { value: own, label: own }] : list;
}

/** Popular cars in Sirdaryo (market analysis: Cobalt 27%, Nexia 19%, Lacetti 16%). */
export const POPULAR_CARS = [
  { make: 'Chevrolet', model: 'Cobalt' },
  { make: 'Chevrolet', model: 'Nexia 3' },
  { make: 'Chevrolet', model: 'Lacetti' },
  { make: 'Chevrolet', model: 'Spark' },
  { make: 'Chevrolet', model: 'Onix' },
  { make: 'Chevrolet', model: 'Malibu' },
  { make: 'BYD', model: 'Chazor' },
] as const;

export interface ApplicationForm {
  fullName: string;
  /** DD.MM.YYYY as typed */
  birthDate: string;
  pinfl: string;
  licenceNumber: string;
  licenceCategories: string[];
  licenceIssuedOn: string;
  licenceCardNumber: string;
  licenceCardExpiresOn: string;
  make: string;
  model: string;
  colour: string;
  plate: string;
  year: string;
  seats: string;
  vehicleClass: VehicleClass;
  features: VehicleFeature[];
  /**
   * The car runs on methane with the tank in the trunk (API `vehicle.cngInTrunk`): even a big
   * trunk then gets no luggage rides.
   */
  cng: boolean;
  /** Optional, as in the passport; an operator verifies it (women drivers, women riders). */
  gender: 'female' | 'male' | null;
  /** taxi (default) or a cargo car: cargo orders only. */
  service: CarService;
  /** Cargo cars: the body type. */
  body: CargoBody | '';
  /** Cargo cars: payload and total mass as typed (kg). */
  payloadKg: string;
  grossKg: string;
}

export const EMPTY_FORM: ApplicationForm = {
  fullName: '',
  birthDate: '',
  pinfl: '',
  licenceNumber: '',
  licenceCategories: ['B'],
  licenceIssuedOn: '',
  licenceCardNumber: '',
  licenceCardExpiresOn: '',
  make: '',
  model: '',
  colour: '',
  plate: '',
  year: '',
  seats: '4',
  vehicleClass: 'economy',
  features: [],
  cng: true,
  gender: null,
  service: 'taxi',
  body: '',
  payloadKg: '',
  grossKg: '',
};

/** "31.12.1990" (also "31/12/1990", "31-12-1990") -> "1990-12-31"; null if not a real date. */
export function parseDate(input: string): string | null {
  const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$/.exec(input);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "1990-12-31" -> "31.12.1990" (prefilling the form from the API). */
export function showDate(ymd: string | null | undefined): string {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/** Whole years from `from` to `to` (YYYY-MM-DD): a birthday counts on the day. */
export function fullYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let years = ty! - fy!;
  if (tm! < fm! || (tm === fm && td! < fd!)) years--;
  return years;
}

/** Today's date in Tashkent (UTC+5, no DST): the API judges ages and expiry by it. */
export function tashkentToday(now: number = Date.now()): string {
  return new Date(now + 5 * 3600_000).toISOString().slice(0, 10);
}

export function normalizeLicenceNumber(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function normalizeCardNumber(input: string): string {
  return input.replace(/\s/g, '').toUpperCase();
}

export type FormErrors = Partial<Record<keyof ApplicationForm, string>>;

/** Which wizard step each field is on (errors from the API jump back to it). */
export const STEP_FIELDS: (keyof ApplicationForm)[][] = [
  ['fullName', 'birthDate', 'pinfl'],
  [
    'licenceNumber',
    'licenceCategories',
    'licenceIssuedOn',
    'licenceCardNumber',
    'licenceCardExpiresOn',
  ],
  [
    'service',
    'make',
    'model',
    'colour',
    'plate',
    'year',
    'seats',
    'vehicleClass',
    'features',
    'body',
    'payloadKg',
    'grossKg',
  ],
];

export function validateApplication(f: ApplicationForm, today: string): FormErrors {
  const e: FormErrors = {};
  if (f.fullName.trim().length < 3) e.fullName = t('apply.validation.fullName');

  const birth = parseDate(f.birthDate);
  if (!birth) e.birthDate = t('apply.validation.birthDateFormat');
  else if (birth > today || fullYears(birth, today) < RULES.minAge) {
    e.birthDate = t('apply.validation.minAge', { years: RULES.minAge });
  }

  if (!/^\d{14}$/.test(f.pinfl.replace(/\s/g, ''))) {
    e.pinfl = t('apply.validation.pinfl');
  }

  if (!/^[A-Z]{2}\d{7}$/.test(normalizeLicenceNumber(f.licenceNumber))) {
    e.licenceNumber = t('apply.validation.licenceNumber');
  }
  if (!f.licenceCategories.includes('B')) e.licenceCategories = t('apply.validation.categoryB');

  const issued = parseDate(f.licenceIssuedOn);
  if (!issued) e.licenceIssuedOn = t('apply.validation.licenceIssuedFormat');
  else if (issued > today || fullYears(issued, today) < RULES.minExperienceYears) {
    e.licenceIssuedOn = t('apply.validation.experience', { years: RULES.minExperienceYears });
  }

  if (!/^[A-Z0-9-]{5,30}$/.test(normalizeCardNumber(f.licenceCardNumber))) {
    e.licenceCardNumber = t('apply.validation.licenceCardNumber');
  }
  const cardExpires = parseDate(f.licenceCardExpiresOn);
  if (!cardExpires) e.licenceCardExpiresOn = t('apply.validation.licenceCardExpiresFormat');
  else if (cardExpires < today) e.licenceCardExpiresOn = t('apply.validation.licenceCardExpired');

  if (f.make.trim().length < 2) e.make = t('apply.validation.make');
  const cargo = f.service === 'cargo';
  if (f.model.trim().length < 1) e.model = t('apply.validation.model');
  else if (!cargo && /\b(damas|labo)\b/i.test(`${f.make} ${f.model}`)) {
    e.model = t('apply.validation.vanAsTaxi');
  }
  if (f.colour.trim().length < 2) e.colour = t('apply.validation.colour');
  const plate = plateProblem(f.plate);
  if (plate) e.plate = plate;

  const thisYear = Number(today.slice(0, 4));
  const year = Number(f.year);
  const maxAge = cargo ? RULES.maxCargoVehicleAgeYears : RULES.maxVehicleAgeYears;
  if (!/^\d{4}$/.test(f.year.trim())) e.year = t('apply.validation.year');
  else if (year > thisYear + 1 || thisYear - year > maxAge) {
    e.year = cargo
      ? t('apply.validation.cargoTooOld', { years: maxAge })
      : t('apply.validation.carTooOld', { years: maxAge });
  }
  const seats = Number(f.seats);
  const maxSeats = cargo
    ? RULES.maxCargoCabSeats
    : f.vehicleClass === 'minivan'
      ? RULES.maxMinivanSeats
      : RULES.maxSeats;
  if (!Number.isInteger(seats) || seats < 1 || seats > maxSeats) {
    e.seats = cargo
      ? t('apply.validation.cabSeats', { max: maxSeats })
      : t('apply.validation.seats', { max: maxSeats });
  }
  if (cargo) {
    Object.assign(e, cargoProblems(f));
    return e;
  }
  if (!e.year && !e.seats) {
    const problem = classProblem(
      f.vehicleClass,
      { make: f.make, model: f.model, year, seats, features: f.features },
      today,
    );
    if (problem) e.vehicleClass = problem;
  }
  return e;
}

/** A whole number of kilograms as typed, or null. */
function kg(text: string): number | null {
  const t = text.replace(/\s/g, '');
  return /^\d{1,6}$/.test(t) ? Number(t) : null;
}

/**
 * The cargo car's own rules (API checkCargoVehicle): a van, pickup or truck body, a payload,
 * a total mass above the payload, and a category C licence above 3.5 t.
 */
export function cargoProblems(f: ApplicationForm): FormErrors {
  const e: FormErrors = {};
  if (!f.body || !(CARGO_BODIES as readonly string[]).includes(f.body)) {
    e.body = t('apply.validation.body');
  }
  const payload = kg(f.payloadKg);
  if (payload === null || payload < 1 || payload > 20_000) {
    e.payloadKg = t('apply.validation.payload');
  }
  if (f.grossKg.trim()) {
    const gross = kg(f.grossKg);
    if (gross === null || gross < 500 || gross > 40_000) {
      e.grossKg = t('apply.validation.gross');
    } else if (payload !== null && payload >= gross) {
      e.grossKg = t('apply.validation.grossBelowPayload');
    } else if (gross > RULES.maxCategoryBGrossKg && !f.licenceCategories.includes('C')) {
      e.licenceCategories = t('apply.validation.categoryC');
    }
  }
  return e;
}

/** The first wizard step with an error, or -1. */
export function firstStepWithError(errors: FormErrors): number {
  return STEP_FIELDS.findIndex((fields) => fields.some((f) => errors[f]));
}

export interface ApplicationBody {
  fullName: string;
  birthDate: string;
  pinfl: string;
  licenceNumber: string;
  licenceCategories: string[];
  licenceIssuedOn: string;
  licenceCardNumber: string;
  licenceCardExpiresOn: string;
  vehicle: {
    make: string;
    model: string;
    colour: string;
    plate: string;
    year: number;
    seats: number;
    class: VehicleClass;
    features: VehicleFeature[];
    cngInTrunk: boolean;
    /** Absent: a taxi (older APIs). */
    service?: CarService;
    body?: CargoBody;
    payloadKg?: number | null;
    grossKg?: number | null;
  };
  gender?: 'female' | 'male';
}

/** The request body; call only after `validateApplication` found nothing. */
export function toApplicationBody(f: ApplicationForm): ApplicationBody {
  return {
    fullName: f.fullName.trim().replace(/\s+/g, ' '),
    birthDate: parseDate(f.birthDate)!,
    pinfl: f.pinfl.replace(/\s/g, ''),
    licenceNumber: normalizeLicenceNumber(f.licenceNumber),
    licenceCategories: [...new Set(f.licenceCategories)],
    licenceIssuedOn: parseDate(f.licenceIssuedOn)!,
    licenceCardNumber: normalizeCardNumber(f.licenceCardNumber),
    licenceCardExpiresOn: parseDate(f.licenceCardExpiresOn)!,
    vehicle: {
      make: f.make.trim(),
      model: f.model.trim(),
      colour: f.colour.trim(),
      plate: normalizePlate(f.plate),
      year: Number(f.year),
      seats: Number(f.seats),
      class: f.vehicleClass,
      features: [...new Set(f.features)],
      // a cargo car carries no gas-tank or luggage question: its load is the point
      cngInTrunk: f.service === 'cargo' ? false : f.cng,
      ...(f.service === 'cargo'
        ? {
            service: 'cargo' as const,
            ...(f.body ? { body: f.body } : {}),
            payloadKg: kg(f.payloadKg),
            grossKg: kg(f.grossKg),
          }
        : {}),
    },
    ...(f.gender ? { gender: f.gender } : {}),
  };
}

/** What the API knows about the driver, back into the form (correcting an application). */
export function formFromProfile(p: {
  fullName: string;
  birthDate: string;
  pinfl: string;
  licence: { number: string; categories: string[]; issuedOn: string };
  licenceCard: { number: string; expiresOn: string };
  vehicle: {
    make: string;
    model: string;
    /** As the API names it in the app's language; `colourCode` is the list's code (newer APIs). */
    colour: string;
    colourCode?: string | null;
    plate: string;
    year: number;
    seats: number;
    class: string;
    features: string[];
    cngInTrunk?: boolean;
    service?: string;
    body?: string | null;
    payloadKg?: number | null;
    grossKg?: number | null;
  } | null;
  gender?: string | null;
}): ApplicationForm {
  const v = p.vehicle;
  const features = (v?.features ?? []).filter((x): x is VehicleFeature =>
    (VEHICLE_FEATURES as readonly string[]).includes(x),
  );
  return {
    fullName: p.fullName,
    birthDate: showDate(p.birthDate),
    pinfl: p.pinfl,
    licenceNumber: p.licence.number,
    licenceCategories: p.licence.categories,
    licenceIssuedOn: showDate(p.licence.issuedOn),
    licenceCardNumber: p.licenceCard.number,
    licenceCardExpiresOn: showDate(p.licenceCard.expiresOn),
    make: v?.make ?? '',
    model: v?.model ?? '',
    // the list's code when the API knows one; older free text stays as its own chip
    colour: v?.colourCode ?? v?.colour ?? '',
    plate: v?.plate ?? '',
    year: v ? String(v.year) : '',
    seats: v ? String(v.seats) : '4',
    vehicleClass: (VEHICLE_CLASSES as readonly string[]).includes(v?.class ?? '')
      ? (v!.class as VehicleClass)
      : 'economy',
    features,
    // most Cobalts/Nexias carry the tank in the trunk: on until the driver says otherwise
    cng: v ? (v.cngInTrunk ?? !features.includes('big_trunk')) : true,
    gender: p.gender === 'female' || p.gender === 'male' ? p.gender : null,
    service: v?.service === 'cargo' ? 'cargo' : 'taxi',
    body: (CARGO_BODIES as readonly string[]).includes(v?.body ?? '') ? (v!.body as CargoBody) : '',
    payloadKg: v?.payloadKg ? String(v.payloadKg) : '',
    grossKg: v?.grossKg ? String(v.grossKg) : '',
  };
}

/** Document kinds the API requires before approval (DOCUMENT_KINDS), with what to photograph. */
export type DocumentKind =
  | 'licence_card'
  | 'driver_licence'
  | 'passport'
  | 'vehicle_registration'
  | 'insurance'
  | 'vehicle_photo'
  | 'selfie';

/** A document kind whose label and hint read in the current language on access. */
function document(kind: DocumentKind, expires: boolean) {
  return {
    kind,
    get label() {
      return t(`apply.documents.kinds.${kind}.label`);
    },
    get hint() {
      return t(`apply.documents.kinds.${kind}.hint`);
    },
    expires,
  };
}

export const DOCUMENTS: { kind: string; label: string; hint: string; expires: boolean }[] = [
  document('licence_card', true),
  document('driver_licence', true),
  document('passport', false),
  document('vehicle_registration', false),
  document('insurance', true),
  document('vehicle_photo', false),
  document('selfie', false),
];
