import { describe, expect, it } from 'vitest';
import { navigationLinks, phoneLink } from './links';

const TO = { lat: 41.3111, lng: 69.2797 };

describe('navigationLinks', () => {
  it('builds Yandex Navigator links with a web fallback', () => {
    expect(navigationLinks('yandex-navi', TO, 'car', 'android')).toEqual({
      app: 'yandexnavi://build_route_on_map?lat_to=41.311100&lon_to=69.279700',
      web: 'https://yandex.uz/maps/?rtext=~41.311100,69.279700&rtt=auto',
    });
  });

  it('picks the Yandex Maps route type from the vehicle', () => {
    expect(navigationLinks('yandex-maps', TO, 'foot', 'ios').app).toBe(
      'yandexmaps://maps.yandex.ru/?rtext=~41.311100,69.279700&rtt=pd',
    );
    expect(navigationLinks('yandex-maps', TO, 'bicycle', 'ios').app).toMatch(/rtt=bc$/);
    expect(navigationLinks('yandex-maps', TO, 'scooter', 'ios').web).toMatch(/rtt=bc$/);
  });

  it('uses the navigation intent on Android and the URL scheme on iOS for Google Maps', () => {
    expect(navigationLinks('google-maps', TO, 'scooter', 'android')).toEqual({
      app: 'google.navigation:q=41.311100,69.279700&mode=b',
      web: 'https://www.google.com/maps/dir/?api=1&destination=41.311100,69.279700&travelmode=bicycling',
    });
    expect(navigationLinks('google-maps', TO, 'car', 'ios').app).toBe(
      'comgooglemaps://?daddr=41.311100,69.279700&directionsmode=driving',
    );
    expect(navigationLinks('google-maps', TO, 'foot', 'ios').web).toMatch(/travelmode=walking$/);
  });

  it('rounds coordinates to six decimals', () => {
    const links = navigationLinks('yandex-navi', { lat: 41.123456789, lng: 69.1 }, 'car', 'ios');
    expect(links.app).toContain('lat_to=41.123457&lon_to=69.100000');
  });
});

describe('phoneLink', () => {
  it('builds tel: links and rejects junk', () => {
    expect(phoneLink('+998901234567')).toBe('tel:+998901234567');
    expect(phoneLink('+998 (71) 200-00-00')).toBe('tel:+998712000000');
    expect(phoneLink(null)).toBeNull();
    expect(phoneLink('')).toBeNull();
    expect(phoneLink('call me')).toBeNull();
  });
});
