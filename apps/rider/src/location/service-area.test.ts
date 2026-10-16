import { afterEach, describe, expect, it } from 'vitest';
import type { GeoCity } from '../api/types';
import { setLanguage } from '../i18n/dictionary';
import { areaNotice, ringToCoordinates, suggestionLine } from './service-area';

afterEach(() => setLanguage('uz'));

const city = (name: string, isActive: boolean): GeoCity => ({
  id: name,
  slug: name.toLowerCase(),
  name,
  nameUz: name,
  nameRu: name,
  center: { lat: 40.5, lng: 68.78 },
  isActive,
  upcoming: !isActive,
});

describe('service area notices', () => {
  it('announces towns that open soon', () => {
    const n = areaNotice({ status: 'upcoming', city: city('Yangiyer', false), nearest: null });
    expect(n.title).toBe('Yangiyer — tez orada');
  });

  it('points to the nearest active city from outside', () => {
    const n = areaNotice({
      status: 'outside',
      city: null,
      nearest: { city: city('Boyovut', false), distanceM: 9000 },
      nearestActive: { city: city('Guliston', true), distanceM: 23_400 },
    });
    expect(n.title).toBe('Bu hududda hozircha ishlamaymiz');
    expect(n.message.replace(/\u00a0/g, ' ')).toContain('Guliston, 23 km');
  });

  it('asks to move the pin only where there is a map', () => {
    const outside = {
      status: 'outside' as const,
      city: null,
      nearest: null,
      nearestActive: { city: city('Guliston', true), distanceM: 93_000 },
    };
    expect(areaNotice(outside).message).toContain('Pinni o‘sha tomonga suring');
    const noMap = areaNotice(outside, false).message;
    expect(noMap).not.toContain('Pin');
    expect(noMap).toContain('«Qayerdan» qatoridan tanlang');
    expect(areaNotice(undefined, false).message).not.toContain('Pin');
  });

  it('still explains itself without an answer from /geo/resolve', () => {
    expect(areaNotice(undefined).title).toBe('Bu hududda hozircha ishlamaymiz');
  });

  it('speaks Russian when the app does', () => {
    setLanguage('ru');
    expect(
      areaNotice({ status: 'upcoming', city: city('Yangiyer', false), nearest: null }),
    ).toEqual({
      title: 'Yangiyer — скоро',
      message: 'Скоро начнём работать в городе Yangiyer. Пока заказать отсюда нельзя.',
    });
    const n = areaNotice({
      status: 'outside',
      city: null,
      nearest: null,
      nearestActive: { city: city('Guliston', true), distanceM: 23_400 },
    });
    expect(n.title).toBe('В этом районе мы пока не работаем');
    expect(n.message.split(String.fromCharCode(160)).join(' ')).toBe(
      'Ближайшая зона обслуживания: Guliston, в 23 км отсюда. Передвиньте метку в ту сторону.',
    );
  });

  it('formats suggestions and polygons', () => {
    expect(suggestionLine({ title: 'Markaziy bozor', subtitle: 'Guliston' })).toBe(
      'Markaziy bozor, Guliston',
    );
    expect(ringToCoordinates([[68.7, 40.4]])).toEqual([{ latitude: 40.4, longitude: 68.7 }]);
  });
});
