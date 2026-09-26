import type { Point } from './geo';

export type NavApp = 'yandex-navi' | 'yandex-maps' | 'google-maps';
export type Vehicle = 'foot' | 'bicycle' | 'scooter' | 'car';
export type Platform = 'android' | 'ios';

export const NAV_APPS: { app: NavApp; label: string }[] = [
  { app: 'yandex-navi', label: 'Yandex Navigator' },
  { app: 'yandex-maps', label: 'Yandex Xaritalar' },
  { app: 'google-maps', label: 'Google Maps' },
];

export interface NavLinks {
  /** Deep link into the installed app. */
  app: string;
  /** Browser route used when the app is not installed. */
  web: string;
}

function coords(p: Point): string {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

/** Yandex route types: auto, pedestrian, bicycle. */
function yandexMode(vehicle: Vehicle): string {
  if (vehicle === 'foot') return 'pd';
  if (vehicle === 'bicycle' || vehicle === 'scooter') return 'bc';
  return 'auto';
}

function googleMode(vehicle: Vehicle): { intent: string; web: string; ios: string } {
  if (vehicle === 'foot') return { intent: 'w', web: 'walking', ios: 'walking' };
  if (vehicle === 'bicycle' || vehicle === 'scooter') {
    return { intent: 'b', web: 'bicycling', ios: 'bicycling' };
  }
  return { intent: 'd', web: 'driving', ios: 'driving' };
}

function yandexWeb(to: Point, vehicle: Vehicle): string {
  return `https://yandex.uz/maps/?rtext=~${coords(to)}&rtt=${yandexMode(vehicle)}`;
}

/** Links that start turn-by-turn navigation from the current position to `to`. */
export function navigationLinks(
  app: NavApp,
  to: Point,
  vehicle: Vehicle,
  platform: Platform,
): NavLinks {
  switch (app) {
    case 'yandex-navi':
      return {
        app: `yandexnavi://build_route_on_map?lat_to=${to.lat.toFixed(6)}&lon_to=${to.lng.toFixed(6)}`,
        web: yandexWeb(to, vehicle),
      };
    case 'yandex-maps':
      return {
        app: `yandexmaps://maps.yandex.ru/?rtext=~${coords(to)}&rtt=${yandexMode(vehicle)}`,
        web: yandexWeb(to, vehicle),
      };
    case 'google-maps': {
      const mode = googleMode(vehicle);
      return {
        app:
          platform === 'android'
            ? `google.navigation:q=${coords(to)}&mode=${mode.intent}`
            : `comgooglemaps://?daddr=${coords(to)}&directionsmode=${mode.ios}`,
        web: `https://www.google.com/maps/dir/?api=1&destination=${coords(to)}&travelmode=${mode.web}`,
      };
    }
  }
}

/** `tel:` link for a phone number as the API returns it, or null when there is none. */
export function phoneLink(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/[^\d+]/g, '') ?? '';
  return /^\+?\d{5,15}$/.test(digits) ? `tel:${digits}` : null;
}
