import { describe, expect, it } from 'vitest';
import type { Tariff } from '../api/types';
import {
  bandPrice,
  calcFare,
  DEFAULT_TARIFF,
  isNightMinute,
  isNightNow,
  validateTariff,
} from './tariff';

const city = (over: Partial<Parameters<typeof calcFare>[0]> = {}) =>
  calcFare(
    { rideClass: 'economy', insideM: 3000, outsideM: 0, options: [], night: false, ...over },
    DEFAULT_TARIFF,
  );

/** Same figures as the API's tariff tests (apps/api/src/lib/tariff.test.ts). */
describe('fare calculator', () => {
  const t = DEFAULT_TARIFF.classes.economy;

  it('charges the band covering the distance, then every started km', () => {
    expect(bandPrice(0, t)).toBe(5000);
    expect(bandPrice(2000, t)).toBe(5000);
    expect(bandPrice(2001, t)).toBe(7000);
    expect(bandPrice(6999, t)).toBe(10_000);
    expect(bandPrice(7001, t)).toBe(10_900);
    expect(bandPrice(9500, t)).toBe(10_000 + 3 * 900);
  });

  it('prices city rides by class, with the night add-on rounded up to 100 so‘m', () => {
    expect(city()).toMatchObject({ kind: 'city', base: 7000, night: 0, total: 7000, seat: null });
    expect(city({ rideClass: 'comfort' }).total).toBe(8800);
    expect(city({ night: true })).toMatchObject({ night: 1400, total: 8400 });
    expect(city({ rideClass: 'comfort', night: true }).total).toBe(10_600);
  });

  it('adds each option once and charges the suburb part per started km', () => {
    const f = city({ options: ['luggage', 'pets', 'pets', 'ac'] });
    expect(f.options).toBe(5000);
    expect(f.total).toBe(12_000);
    const out = city({ insideM: 4000, outsideM: 3200 });
    expect(out).toMatchObject({ outside: 4 * 1500, base: 7000 + 6000, total: 13_000 });
  });

  it('turns intercity at 20 km: whole car per km, the seat share, the minimum', () => {
    const f = city({ insideM: 30_000 });
    expect(f).toMatchObject({ kind: 'intercity', base: 51_000, total: 51_000 });
    expect(f.seat).toEqual({ rear: 15_300, front: 16_900 });
    expect(city({ insideM: 19_999 }).kind).toBe('city');
    expect(city({ insideM: 15_000, outsideM: 5000 }).kind).toBe('intercity');
    const cheap = structuredClone(DEFAULT_TARIFF);
    cheap.classes.economy.intercity_per_km = 500;
    expect(
      calcFare(
        { rideClass: 'economy', insideM: 25_000, outsideM: 0, options: [], night: false },
        cheap,
      ).base,
    ).toBe(25_000);
  });

  it('knows night windows across midnight and within a day', () => {
    const night = DEFAULT_TARIFF.night;
    expect(isNightMinute(23 * 60 + 30, night)).toBe(true);
    expect(isNightMinute(5 * 60 + 59, night)).toBe(true);
    expect(isNightMinute(6 * 60, night)).toBe(false);
    expect(isNightMinute(22 * 60 + 59, night)).toBe(false);
    const evening = { percent: 10, from: '18:00', to: '20:00' };
    expect(isNightMinute(19 * 60, evening)).toBe(true);
    expect(isNightMinute(20 * 60, evening)).toBe(false);
    expect(isNightMinute(19 * 60, { ...evening, to: '18:00' })).toBe(false);
    // 18:30 UTC is 23:30 in Tashkent
    expect(isNightNow(night, Date.parse('2026-09-28T18:30:00Z'))).toBe(true);
    expect(isNightNow(night, Date.parse('2026-09-28T07:00:00Z'))).toBe(false);
  });
});

describe('tariff validation', () => {
  it('accepts the launch tariff', () => {
    expect(validateTariff(DEFAULT_TARIFF)).toEqual([]);
  });

  it('refuses bands that do not grow, empty fields and bad times', () => {
    const bad: Tariff = structuredClone(DEFAULT_TARIFF);
    bad.classes.economy.bands = [
      { up_to_m: 4000, price: 7000 },
      { up_to_m: 2000, price: 5000 },
    ];
    bad.classes.comfort.beyond_per_km = NaN;
    bad.night.from = '25:00';
    bad.waiting.free_minutes = 31;
    bad.options.pets = -1;
    const paths = validateTariff(bad).map((p) => p.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'classes.economy.bands.1.up_to_m',
        'classes.comfort.beyond_per_km',
        'night.from',
        'waiting.free_minutes',
        'options.pets',
      ]),
    );
  });

  it('needs one to ten bands within 0.1–100 km', () => {
    const none = structuredClone(DEFAULT_TARIFF);
    none.classes.economy.bands = [];
    expect(validateTariff(none).map((p) => p.path)).toContain('classes.economy.bands');
    const far = structuredClone(DEFAULT_TARIFF);
    far.classes.economy.bands = [{ up_to_m: 150_000, price: 5000 }];
    expect(validateTariff(far).map((p) => p.path)).toContain('classes.economy.bands.0.up_to_m');
  });
});
