import type { DriverClasses, RideClass } from '../api/types';

/** Taxi class names (apps/api src/lib/ride-classes.ts). */
export const CLASS_NAMES: Record<RideClass, string> = {
  economy: 'Ekonom',
  comfort: 'Komfort',
  minivan: 'Miniven',
  business: 'Biznes',
};

const names = (list: RideClass[]) => list.map((c) => CLASS_NAMES[c] ?? c).join(', ');

/**
 * The profile's class card in words: the car's class, the rides that come, the switch for
 * lower classes and the classes the car meets the rules of.
 */
export function classesText(c: DriverClasses) {
  const others = c.qualifiesFor.filter((k) => k !== c.own);
  return {
    own: CLASS_NAMES[c.own] ?? c.own,
    rides: names(c.rides),
    toggle: `${names(c.lower)} buyurtmalarini ham olaman`,
    toggleHint: c.takesLower
      ? 'Arzonroq sinf buyurtmalari ham keladi: bo‘sh turish kamayadi.'
      : `Faqat ${CLASS_NAMES[c.own]} buyurtmalari keladi.`,
    qualifies: others.length
      ? `Avtomobilingiz ${names(others)} talablariga ham mos: sinfni o‘zgartirish uchun operatorga murojaat qiling (texnik ko‘rik).`
      : 'Sinfni o‘zgartirish uchun operatorga murojaat qiling (texnik ko‘rik).',
  };
}
