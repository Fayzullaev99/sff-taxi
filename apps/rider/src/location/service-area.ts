/** Rider-facing wording for service areas (pure, unit-tested). */
import type { GeoResolve, GeoSuggestion } from '../api/types';
import { t } from '../i18n/dictionary';
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
export function areaNotice(resolve: GeoResolve | undefined, withMap = true): AreaNotice {
  // without a map (Android build without a Maps key) there is no pin to move
  const move = withMap ? t('home.area.movePin') : t('home.area.pickFromSearch');
  const elsewhere = withMap ? t('home.area.tryElsewhere') : t('home.area.pickFromSearch');
  if (resolve && resolve.status === 'upcoming') {
    return {
      title: t('home.area.upcomingTitle', { city: resolve.city.name }),
      message: t('home.area.upcomingMessage', { city: resolve.city.name }),
    };
  }
  const nearest = resolve && resolve.status === 'outside' ? resolve.nearestActive : null;
  return {
    title: t('home.area.outsideTitle'),
    message: nearest
      ? t('home.area.nearest', {
          city: nearest.city.name,
          distance: formatDistance(nearest.distanceM),
          advice: move,
        })
      : t('home.area.expanding', { advice: elsewhere }),
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
