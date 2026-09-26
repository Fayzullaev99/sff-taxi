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

export function checkVehicle(v: VehicleFacts, today: string): RuleProblem[] {
  const problems: RuleProblem[] = [];
  const year = Number(today.slice(0, 4));
  if (isVanType(v.make, v.model)) {
    problems.push({
      path: 'vehicle.model',
      message: 'Furgon turidagi avtomobillar taksi bo‘la olmaydi',
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
