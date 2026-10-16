import type { DriverClasses, RideClass } from '../api/types';
import { liveTable, t } from '../i18n/dictionary';

/** Taxi class names (apps/api src/lib/ride-classes.ts), in the app's language on access. */
export const CLASS_NAMES: Record<RideClass, string> = liveTable({
  economy: 'common.classes.economy',
  comfort: 'common.classes.comfort',
  minivan: 'common.classes.minivan',
  business: 'common.classes.business',
});

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
    toggle: t('home.classes.toggle', { classes: names(c.lower) }),
    toggleHint: c.takesLower
      ? t('home.classes.toggleOn')
      : t('home.classes.toggleOff', { class: CLASS_NAMES[c.own] }),
    qualifies: others.length
      ? t('home.classes.qualifiesOthers', { classes: names(others) })
      : t('home.classes.qualifies'),
  };
}
