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
} as const;

export const LICENCE_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'BE', 'CE', 'DE'] as const;
export const VEHICLE_FEATURES = ['ac', 'child_seat', 'pets', 'big_trunk'] as const;
export type VehicleFeature = (typeof VEHICLE_FEATURES)[number];

export const FEATURE_LABELS: Record<VehicleFeature, string> = {
  ac: 'Konditsioner',
  child_seat: 'Bolalar o‘rindig‘i',
  pets: 'Uy hayvonlarini olaman',
  big_trunk: 'Katta yukxona',
};

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
  vehicleClass: 'economy' | 'comfort';
  features: VehicleFeature[];
  /**
   * The car runs on methane with the tank in the trunk (API `vehicle.cngInTrunk`): even a big
   * trunk then gets no luggage rides.
   */
  cng: boolean;
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
  ['make', 'model', 'colour', 'plate', 'year', 'seats', 'vehicleClass', 'features'],
];

export function validateApplication(f: ApplicationForm, today: string): FormErrors {
  const e: FormErrors = {};
  if (f.fullName.trim().length < 3) e.fullName = 'Familiya, ism va otangizning ismini yozing';

  const birth = parseDate(f.birthDate);
  if (!birth) e.birthDate = 'Sanani KK.OO.YYYY ko‘rinishida yozing, masalan 05.03.1990';
  else if (birth > today || fullYears(birth, today) < RULES.minAge) {
    e.birthDate = `Haydovchi kamida ${RULES.minAge} yoshda bo‘lishi kerak`;
  }

  if (!/^\d{14}$/.test(f.pinfl.replace(/\s/g, ''))) {
    e.pinfl = 'JShShIR 14 ta raqamdan iborat (pasportingizda)';
  }

  if (!/^[A-Z]{2}\d{7}$/.test(normalizeLicenceNumber(f.licenceNumber))) {
    e.licenceNumber = 'Guvohnoma raqami: 2 harf va 7 raqam, masalan AF1234567';
  }
  if (!f.licenceCategories.includes('B')) e.licenceCategories = 'B toifali guvohnoma kerak';

  const issued = parseDate(f.licenceIssuedOn);
  if (!issued) e.licenceIssuedOn = 'Guvohnoma berilgan sanani KK.OO.YYYY ko‘rinishida yozing';
  else if (issued > today || fullYears(issued, today) < RULES.minExperienceYears) {
    e.licenceIssuedOn = `Haydovchilik staji kamida ${RULES.minExperienceYears} yil bo‘lishi kerak`;
  }

  if (!/^[A-Z0-9-]{5,30}$/.test(normalizeCardNumber(f.licenceCardNumber))) {
    e.licenceCardNumber = 'Litsenziya kartochkasi raqamini kiriting (harflar va raqamlar)';
  }
  const cardExpires = parseDate(f.licenceCardExpiresOn);
  if (!cardExpires) e.licenceCardExpiresOn = 'Amal qilish muddatini KK.OO.YYYY ko‘rinishida yozing';
  else if (cardExpires < today) e.licenceCardExpiresOn = 'Litsenziya kartochkasi muddati o‘tgan';

  if (f.make.trim().length < 2) e.make = 'Markani yozing, masalan Chevrolet';
  if (f.model.trim().length < 1) e.model = 'Modelni yozing, masalan Cobalt';
  else if (/\b(damas|labo)\b/i.test(`${f.make} ${f.model}`)) {
    e.model = 'Furgon turidagi avtomobillar (Damas, Labo) taksi bo‘la olmaydi';
  }
  if (f.colour.trim().length < 2) e.colour = 'Rangini yozing, masalan Oq';
  const plate = plateProblem(f.plate);
  if (plate) e.plate = plate;

  const thisYear = Number(today.slice(0, 4));
  const year = Number(f.year);
  if (!/^\d{4}$/.test(f.year.trim())) e.year = 'Ishlab chiqarilgan yilni yozing, masalan 2019';
  else if (year > thisYear + 1 || thisYear - year > RULES.maxVehicleAgeYears) {
    e.year = `Avtomobil ${RULES.maxVehicleAgeYears} yildan eski bo‘lmasligi kerak`;
  }
  const seats = Number(f.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > RULES.maxSeats) {
    e.seats = `Yo‘lovchi o‘rindiqlari 1 dan ${RULES.maxSeats} tagacha`;
  }
  if (f.vehicleClass === 'comfort') {
    if (!e.year && thisYear - year > RULES.maxComfortAgeYears) {
      e.vehicleClass = `Komfort uchun avtomobil ${RULES.maxComfortAgeYears} yildan eski bo‘lmasligi kerak`;
    } else if (!f.features.includes('ac')) {
      e.vehicleClass = 'Komfort uchun konditsioner kerak';
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
    class: 'economy' | 'comfort';
    features: VehicleFeature[];
    cngInTrunk: boolean;
  };
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
      cngInTrunk: f.cng,
    },
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
    colour: string;
    plate: string;
    year: number;
    seats: number;
    class: string;
    features: string[];
    cngInTrunk?: boolean;
  } | null;
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
    colour: v?.colour ?? '',
    plate: v?.plate ?? '',
    year: v ? String(v.year) : '',
    seats: v ? String(v.seats) : '4',
    vehicleClass: v?.class === 'comfort' ? 'comfort' : 'economy',
    features,
    // most Cobalts/Nexias carry the tank in the trunk: on until the driver says otherwise
    cng: v ? (v.cngInTrunk ?? !features.includes('big_trunk')) : true,
  };
}

/** Document kinds the API requires before approval (DOCUMENT_KINDS), with what to photograph. */
export const DOCUMENTS: { kind: string; label: string; hint: string; expires: boolean }[] = [
  {
    kind: 'licence_card',
    label: 'Litsenziya kartochkasi',
    hint: 'Yo‘lovchi tashish litsenziya kartochkasi',
    expires: true,
  },
  {
    kind: 'driver_licence',
    label: 'Haydovchilik guvohnomasi',
    hint: 'Ikkala tomoni bitta rasmda',
    expires: true,
  },
  { kind: 'passport', label: 'Pasport (ID karta)', hint: 'Rasmli sahifa', expires: false },
  {
    kind: 'vehicle_registration',
    label: 'Texpasport',
    hint: 'Avtomobilni ro‘yxatdan o‘tkazish guvohnomasi',
    expires: false,
  },
  { kind: 'insurance', label: 'Sug‘urta polisi', hint: 'Amaldagi polis', expires: true },
  {
    kind: 'vehicle_photo',
    label: 'Avtomobil rasmi',
    hint: 'Old tomondan, davlat raqami ko‘rinsin',
    expires: false,
  },
  { kind: 'selfie', label: 'Selfi', hint: 'Yuzingiz aniq ko‘rinsin', expires: false },
];
