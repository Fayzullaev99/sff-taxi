import { sql } from 'kysely';
import { carClassesForRide, TAKES_LOWER_BY_DEFAULT } from '../../lib/ride-classes.js';
import type { RideClass } from '../../lib/tariff.js';

/**
 * SQL over drivers `d` joined with vehicles `v`: the car takes rides of this class — its own
 * class, or a higher class whose driver takes lower classes (their choice, else the class's
 * default). The same rule as src/lib/ride-classes.ts carTakes.
 */
export function takesClassSql(rideClass: RideClass) {
  const higher = carClassesForRide(rideClass).filter((c) => c !== rideClass);
  if (!higher.length) return sql<boolean>`v.class = ${rideClass}`;
  return sql<boolean>`(v.class = ${rideClass} or (v.class in (${sql.join(higher)}) and coalesce(d.takes_lower_classes, v.class in (${sql.join([...TAKES_LOWER_BY_DEFAULT])}))))`;
}
