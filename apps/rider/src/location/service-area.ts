/** Rider-facing wording for service areas (pure, unit-tested). */
import type { GeoResolve, GeoSuggestion } from '../api/types';
import { formatDistance } from '../lib/format';

export interface AreaNotice {
  title: string;
  message: string;
}

/**
 * Why a ride cannot start here: a town that opens soon, or outside every service area
 * (the villages within the service radius of Guliston are served; the caller checks
 * that with /tariffs first and asks /geo/resolve only when the answer was "no").
 */
export function areaNotice(resolve: GeoResolve | undefined): AreaNotice {
  if (resolve && resolve.status === 'upcoming') {
    return {
      title: `${resolve.city.name} — tez orada`,
      message: `${resolve.city.name} shahrida tez orada ishga tushamiz. Hozircha bu yerdan buyurtma berib bo‘lmaydi.`,
    };
  }
  const nearest = resolve && resolve.status === 'outside' ? resolve.nearestActive : null;
  return {
    title: 'Bu hududda hozircha ishlamaymiz',
    message: nearest
      ? `Eng yaqin xizmat hududi: ${nearest.city.name}, ${formatDistance(nearest.distanceM)} uzoqlikda. Pinni o‘sha tomonga suring.`
      : 'Xizmat hududlari tez orada kengayadi. Pinni boshqa joyga qo‘yib ko‘ring.',
  };
}

/** One line for an address suggestion: title, then where it is. */
export function suggestionLine(s: Pick<GeoSuggestion, 'title' | 'subtitle'>): string {
  return s.subtitle ? `${s.title}, ${s.subtitle}` : s.title;
}

/** Rings of [lng, lat] as map coordinates. */
export function ringToCoordinates(
  ring: [number, number][],
): { latitude: number; longitude: number }[] {
  return ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}
