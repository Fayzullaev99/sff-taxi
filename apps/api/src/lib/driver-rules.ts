/**
 * Who may drive and in what car: Cabinet Resolution No. 200 (02.04.2025), cl. 10 and the
 * vehicle rules, as summarised in docs/market-analysis.md §4. Pure functions; the drivers
 * service applies them to applications and operator approvals.
 */
export const DRIVER_RULES = {
  /** cl. 10: age 21+ */
  minAge: 21,
  /** cl. 10: 3+ years of driving experience */
  minExperienceYears: 3,
  /** city taxi: the car is at most 15 years old */
  maxVehicleAgeYears: 15,
  /** SFF Comfort: at most 5 years old, with air conditioning (market analysis §6.3) */
  maxComfortAgeYears: 5,
  /** at most 4 passenger seats besides the driver */
  maxSeats: 4,
  /**
   * cargo cars: the cab's seats besides the driver (Damas/Labo 1, Gazel/Porter/Isuzu 2); the
   * customer may ride along, one order at a time (riderRides)
   */
  maxCargoCabSeats: 2,
  /** cargo cars (not passenger taxis): at most 25 years old */
  maxCargoVehicleAgeYears: 25,
  /** above this total (gross) mass a category C licence is needed; up to it B is enough */
  maxCategoryBGrossKg: 3500,
} as const;

/**
 * Region codes that start Uzbek plates: Tashkent city 01, Tashkent region 10, Sirdaryo 20,
 * Jizzakh 25, Samarkand 30, Fergana 40, Namangan 50, Andijan 60, Kashkadarya 70,
 * Surkhandarya 75, Bukhara 80, Navoi 85, Khorezm 90, Karakalpakstan 95.
 */
export const PLATE_REGIONS = [
  '01',
  '10',
  '20',
  '25',
  '30',
  '40',
  '50',
  '60',
  '70',
  '75',
  '80',
  '85',
  '90',
  '95',
] as const;

const PRIVATE = /^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/;
const COMPANY = /^(\d{2})(\d{3})([A-Z]{3})$/;

/** "20 a 123 bc", "20-A-123-BC" -> "20A123BC". */
export function normalizePlate(input: string): string {
  return input.replace(/[\s\-.]/g, '').toUpperCase();
}

/** A normalised plate in one of the two current formats with a real region code. */
export function isUzPlate(plate: string): boolean {
  const m = PRIVATE.exec(plate) ?? COMPANY.exec(plate);
  return Boolean(m && (PLATE_REGIONS as readonly string[]).includes(m[1]!));
}

/** How the plate is written on the car: "20 A 123 BC" or "20 123 ABC". */
export function formatPlate(plate: string): string {
  const p = PRIVATE.exec(plate);
  if (p) return `${p[1]} ${p[2]} ${p[3]} ${p[4]}`;
  const c = COMPANY.exec(plate);
  return c ? `${c[1]} ${c[2]} ${c[3]}` : plate;
}

/** "AF 1234567" -> "AF1234567". */
export function normalizeLicenceNumber(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/** Bodies of cargo cars (src/lib/cargo.ts CARGO_BODIES): never a passenger taxi. */
const CARGO_BODY: readonly string[] = ['van', 'pickup', 'truck'];

/** Van-type cars may not work as taxis (Res. 200). */
export function isVanType(make: string, model: string): boolean {
  return /\b(damas|labo)\b/i.test(`${make} ${model}`);
}

/** Today's date in Tashkent (UTC+5, no DST) as YYYY-MM-DD. */
export function tashkentDate(now: Date): string {
  return new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}

/** Whole years from `from` to `to` (both YYYY-MM-DD): a birthday counts on the day. */
export function fullYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let years = ty! - fy!;
  if (tm! < fm! || (tm === fm && td! < fd!)) years--;
  return years;
}

export interface ApplicantFacts {
  birthDate: string;
  licenceIssuedOn: string;
  licenceCategories: string[];
  licenceCardExpiresOn: string;
}

export interface VehicleFacts {
  make: string;
  model: string;
  year: number;
  seats: number;
  class: 'economy' | 'comfort';
  features: string[];
  /** What the car works for: a passenger taxi (Resolution 200) or cargo. Default taxi. */
  service?: 'taxi' | 'cargo';
  body?: string;
  payloadKg?: number | null;
  grossKg?: number | null;
}

export interface RuleProblem {
  path: string;
  message: string;
}

/** Everything wrong with an application, in Uzbek; empty when it is acceptable. */
export function checkApplicant(a: ApplicantFacts, today: string): RuleProblem[] {
  const problems: RuleProblem[] = [];
  if (a.birthDate > today || fullYears(a.birthDate, today) < DRIVER_RULES.minAge) {
    problems.push({
      path: 'birthDate',
      message: `Haydovchi kamida ${DRIVER_RULES.minAge} yoshda bo‘lishi kerak`,
    });
  }
  if (
    a.licenceIssuedOn > today ||
    fullYears(a.licenceIssuedOn, today) < DRIVER_RULES.minExperienceYears
  ) {
    problems.push({
      path: 'licenceIssuedOn',
      message: `Haydovchilik staji kamida ${DRIVER_RULES.minExperienceYears} yil bo‘lishi kerak`,
    });
  }
  if (!a.licenceCategories.includes('B')) {
    problems.push({ path: 'licenceCategories', message: 'B toifali guvohnoma kerak' });
  }
  if (a.licenceCardExpiresOn < today) {
    problems.push({
      path: 'licenceCardExpiresOn',
      message: 'Litsenziya kartochkasi muddati o‘tgan',
    });
  }
  return problems;
}

/**
 * The car's rules. A passenger taxi follows Resolution 200 (no vans, at most 4 seats, at
 * most 15 years old); a cargo car does not carry passengers for money and follows the cargo
 * rules instead (checkCargoVehicle). `licenceCategories`: the driver's, for cargo.
 */
export function checkVehicle(
  v: VehicleFacts,
  today: string,
  licenceCategories: string[] = ['B'],
): RuleProblem[] {
  if (v.service === 'cargo') return checkCargoVehicle(v, today, licenceCategories);
  const problems: RuleProblem[] = [];
  const year = Number(today.slice(0, 4));
  if (isVanType(v.make, v.model)) {
    problems.push({
      path: 'vehicle.model',
      message: 'Furgon turidagi avtomobillar taksi bo‘la olmaydi',
    });
  } else if (v.body && CARGO_BODY.includes(v.body)) {
    problems.push({
      path: 'vehicle.body',
      message: 'Yuk kuzovli avtomobil taksi bo‘la olmaydi: yuk tashish uchun ariza bering',
    });
  }
  if (v.year > year + 1 || year - v.year > DRIVER_RULES.maxVehicleAgeYears) {
    problems.push({
      path: 'vehicle.year',
      message: `Avtomobil ${DRIVER_RULES.maxVehicleAgeYears} yildan eski bo‘lmasligi kerak`,
    });
  }
  if (v.seats < 1 || v.seats > DRIVER_RULES.maxSeats) {
    problems.push({
      path: 'vehicle.seats',
      message: `Yo‘lovchi o‘rindiqlari ${DRIVER_RULES.maxSeats} tadan ko‘p bo‘lmasligi kerak`,
    });
  }
  if (v.class === 'comfort') {
    if (year - v.year > DRIVER_RULES.maxComfortAgeYears) {
      problems.push({
        path: 'vehicle.class',
        message: `Komfort uchun avtomobil ${DRIVER_RULES.maxComfortAgeYears} yildan eski bo‘lmasligi kerak`,
      });
    }
    if (!v.features.includes('ac')) {
      problems.push({ path: 'vehicle.class', message: 'Komfort uchun konditsioner kerak' });
    }
  }
  return problems;
}

/**
 * A cargo car: a van, pickup or truck body with a payload, at most 25 years old; a car of
 * more than 3.5 t total mass needs a category C licence (B is enough up to 3.5 t). Seats are
 * the cab's besides the driver: 1-2 (the customer may ride along).
 */
export function checkCargoVehicle(
  v: VehicleFacts,
  today: string,
  licenceCategories: string[],
): RuleProblem[] {
  const problems: RuleProblem[] = [];
  const year = Number(today.slice(0, 4));
  if (!v.body || !CARGO_BODY.includes(v.body)) {
    problems.push({
      path: 'vehicle.body',
      message: 'Yuk mashinasi furgon, pikap yoki yuk kuzovli bo‘lishi kerak',
    });
  }
  if (!v.payloadKg || v.payloadKg <= 0) {
    problems.push({ path: 'vehicle.payloadKg', message: 'Yuk ko‘tarish quvvatini kiriting (kg)' });
  }
  if (v.year > year + 1 || year - v.year > DRIVER_RULES.maxCargoVehicleAgeYears) {
    problems.push({
      path: 'vehicle.year',
      message: `Yuk mashinasi ${DRIVER_RULES.maxCargoVehicleAgeYears} yildan eski bo‘lmasligi kerak`,
    });
  }
  if (v.seats < 1 || v.seats > DRIVER_RULES.maxCargoCabSeats) {
    problems.push({
      path: 'vehicle.seats',
      message: `Kabinada haydovchidan tashqari 1 yoki ${DRIVER_RULES.maxCargoCabSeats} o‘rin bo‘ladi`,
    });
  }
  if (
    v.grossKg &&
    v.grossKg > DRIVER_RULES.maxCategoryBGrossKg &&
    !licenceCategories.includes('C')
  ) {
    problems.push({
      path: 'licenceCategories',
      message: '3,5 tonnadan og‘ir mashina uchun C toifali guvohnoma kerak',
    });
  }
  if (v.grossKg && v.payloadKg && v.payloadKg >= v.grossKg) {
    problems.push({
      path: 'vehicle.grossKg',
      message: 'To‘liq massa yuk ko‘tarish quvvatidan katta bo‘lishi kerak',
    });
  }
  return problems;
}
