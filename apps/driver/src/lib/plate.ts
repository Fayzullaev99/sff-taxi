/**
 * Uzbek number plates, mirroring the API's check (apps/api src/lib/driver-rules.ts) so the
 * form can explain the format before sending. Two current formats:
 * private "20 A 123 BC" and company "20 123 ABC"; the first two digits are the region.
 */
export const PLATE_REGIONS: Record<string, string> = {
  '01': 'Toshkent shahri',
  '10': 'Toshkent viloyati',
  '20': 'Sirdaryo',
  '25': 'Jizzax',
  '30': 'Samarqand',
  '40': 'Farg‘ona',
  '50': 'Namangan',
  '60': 'Andijon',
  '70': 'Qashqadaryo',
  '75': 'Surxondaryo',
  '80': 'Buxoro',
  '85': 'Navoiy',
  '90': 'Xorazm',
  '95': 'Qoraqalpog‘iston',
};

const PRIVATE = /^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/;
const COMPANY = /^(\d{2})(\d{3})([A-Z]{3})$/;

export const PLATE_HINT = 'Masalan: 20 A 123 BC yoki 20 123 ABC (20 — Sirdaryo)';

/** "20 a 123 bc", "20-A-123-BC" -> "20A123BC". */
export function normalizePlate(input: string): string {
  return input.replace(/[\s\-.]/g, '').toUpperCase();
}

export function isUzPlate(plate: string): boolean {
  const m = PRIVATE.exec(plate) ?? COMPANY.exec(plate);
  return Boolean(m && m[1]! in PLATE_REGIONS);
}

/** How the plate is written on the car: "20 A 123 BC" or "20 123 ABC". */
export function formatPlate(plate: string): string {
  const p = PRIVATE.exec(plate);
  if (p) return `${p[1]} ${p[2]} ${p[3]} ${p[4]}`;
  const c = COMPANY.exec(plate);
  return c ? `${c[1]} ${c[2]} ${c[3]}` : plate;
}

/** A problem with a typed plate in Uzbek, or null when it is valid. */
export function plateProblem(input: string): string | null {
  const plate = normalizePlate(input);
  if (!plate) return 'Davlat raqamini kiriting';
  const region = plate.slice(0, 2);
  if (/^\d{2}/.test(plate) && !(region in PLATE_REGIONS)) {
    return `${region} — bunday viloyat kodi yo‘q`;
  }
  return isUzPlate(plate) ? null : `Davlat raqami noto‘g‘ri. ${PLATE_HINT}`;
}
