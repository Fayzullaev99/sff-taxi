import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PolygonRings } from './geo.js';
import {
  bandPrice,
  computeFare,
  DEFAULT_TARIFF,
  DERIVED_CLASS_PERCENT,
  deriveClassTariff,
  enabledClasses,
  type FareInput,
  freeWaitingOver,
  isNight,
  RIDE_CLASSES,
  type RideClass,
  splitInsideOutside,
  Tariff,
  waitingFee,
} from './tariff.js';

/** A moment given in Tashkent local time (UTC+5). */
const tashkent = (iso: string) => new Date(`${iso}+05:00`);
const NOON = tashkent('2026-09-28T12:00');

/** Guliston's boundary as seeded by migrations/0002_geo.sql. */
const GULISTON_BOUNDARY: PolygonRings = JSON.parse(
  /\('guliston'[^\n]*\n\s+'(\[\[\[[^']+\]\]\])'/.exec(
    readFileSync(new URL('../../migrations/0002_geo.sql', import.meta.url), 'utf8'),
  )![1]!,
);
const CENTRE = { lat: 40.49598, lng: 68.77587 };
const NEAR_CENTRE = { lat: 40.5095, lng: 68.77587 };
/** ~3.5 km south of Guliston's boundary, in fields (a village). */
const SOUTH_VILLAGE = { lat: 40.44, lng: 68.78 };

const fare = (over: Partial<FareInput>) =>
  computeFare(
    {
      pickup: CENTRE,
      dropoff: NEAR_CENTRE,
      roadM: 3000,
      boundary: GULISTON_BOUNDARY,
      rideClass: 'economy',
      options: [],
      at: NOON,
      ...over,
    },
    DEFAULT_TARIFF,
  );

describe('distance bands', () => {
  const t = DEFAULT_TARIFF.classes.economy;

  it('charges the band covering the distance', () => {
    expect(bandPrice(0, t)).toBe(5000);
    expect(bandPrice(2000, t)).toBe(5000);
    expect(bandPrice(2001, t)).toBe(7000);
    expect(bandPrice(4000, t)).toBe(7000);
    expect(bandPrice(6999, t)).toBe(10_000);
  });

  it('adds every started km beyond the last band', () => {
    expect(bandPrice(7001, t)).toBe(10_900);
    expect(bandPrice(9500, t)).toBe(10_000 + 3 * 900);
  });

  it('refuses bands that do not grow', () => {
    const bad = structuredClone(DEFAULT_TARIFF);
    bad.classes.economy.bands = [
      { up_to_m: 4000, price: 7000 },
      { up_to_m: 2000, price: 5000 },
    ];
    expect(Tariff.safeParse(bad).success).toBe(false);
    expect(Tariff.safeParse(DEFAULT_TARIFF).success).toBe(true);
  });
});

describe('city fares', () => {
  it('prices an in-city ride by its band, the same all day', () => {
    const f = fare({});
    expect(f).toMatchObject({
      kind: 'city',
      distanceM: 3000,
      insideM: 3000,
      outsideM: 0,
      base: 7000,
      night: 0,
      total: 7000,
      seat: null,
    });
    expect(fare({ rideClass: 'comfort' }).total).toBe(8800);
  });

  it('adds a fixed 20% at night (23:00-06:00 Tashkent), rounded to 100 so‘m', () => {
    expect(fare({ at: tashkent('2026-09-28T23:30') })).toMatchObject({ night: 1400, total: 8400 });
    expect(fare({ at: tashkent('2026-09-29T05:59') }).night).toBe(1400);
    expect(fare({ at: tashkent('2026-09-29T06:00') }).night).toBe(0);
    expect(fare({ at: tashkent('2026-09-28T22:59') }).night).toBe(0);
    expect(fare({ rideClass: 'comfort', at: tashkent('2026-09-28T23:00') }).total).toBe(10_600);
  });

  it('adds options once each', () => {
    const f = fare({ options: ['luggage', 'pets', 'pets', 'ac'] });
    expect(f.options).toEqual({ luggage: 2000, pets: 3000, ac: 0 });
    expect(f.total).toBe(12_000);
  });

  it('charges the suburb part of the route per km', () => {
    const split = splitInsideOutside({
      pickup: CENTRE,
      dropoff: SOUTH_VILLAGE,
      roadM: 8000,
      boundary: GULISTON_BOUNDARY,
    });
    expect(split.outsideM).toBeGreaterThan(3500);
    expect(split.outsideM).toBeLessThan(5500);
    expect(split.insideM + split.outsideM).toBe(8000);
    const f = fare({ dropoff: SOUTH_VILLAGE, roadM: 8000 });
    const km = Math.ceil(split.outsideM / 1000);
    expect(f).toMatchObject({ kind: 'city', outsideM: split.outsideM, outside: km * 1500 });
    expect(f.total).toBe(bandPrice(split.insideM, DEFAULT_TARIFF.classes.economy) + km * 1500);
  });
});

describe('intercity fares', () => {
  it('charges the whole car per km from 20 km, with the seat share', () => {
    // Guliston -> Yangiyer, ~30 km by road: 51 000 (Yandex Start cap ~71 000)
    const f = fare({ dropoff: { lat: 40.2701, lng: 68.8166 }, roadM: 30_000 });
    expect(f).toMatchObject({ kind: 'intercity', base: 51_000, total: 51_000 });
    // a seat is 30%; the front seat 10% more
    expect(f.seat).toEqual({ rear: 15_300, front: 16_900 });
    expect(fare({ roadM: 19_999 }).kind).toBe('city');
    expect(fare({ roadM: 20_000 }).kind).toBe('intercity');
  });

  it('never goes below the minimum', () => {
    const cheap = structuredClone(DEFAULT_TARIFF);
    cheap.classes.economy.intercity_per_km = 500;
    const f = computeFare(
      {
        pickup: CENTRE,
        dropoff: NEAR_CENTRE,
        roadM: 25_000,
        boundary: GULISTON_BOUNDARY,
        rideClass: 'economy',
        options: [],
        at: NOON,
      },
      cheap,
    );
    expect(f.base).toBe(25_000);
  });
});

describe('waiting', () => {
  const arrived = tashkent('2026-09-28T12:00');
  const after = (s: number) => new Date(arrived.getTime() + s * 1000);

  it('is free for 2 minutes, then 500 so‘m per started minute', () => {
    expect(waitingFee(arrived, after(120), DEFAULT_TARIFF)).toBe(0);
    expect(waitingFee(arrived, after(121), DEFAULT_TARIFF)).toBe(500);
    expect(waitingFee(arrived, after(300), DEFAULT_TARIFF)).toBe(1500);
    expect(freeWaitingOver(arrived, after(119), DEFAULT_TARIFF)).toBe(false);
    expect(freeWaitingOver(arrived, after(120), DEFAULT_TARIFF)).toBe(true);
  });

  it('knows a night window that does not cross midnight too', () => {
    const evening = { percent: 10, from: '18:00', to: '20:00' };
    expect(isNight(tashkent('2026-09-28T19:00'), evening)).toBe(true);
    expect(isNight(tashkent('2026-09-28T20:00'), evening)).toBe(false);
    expect(isNight(tashkent('2026-09-28T19:00'), { ...evening, to: '18:00' })).toBe(false);
  });
});

describe('classes', () => {
  /** A tariff document as stored before minivan and business existed (no `enabled` either). */
  const stored = () => {
    const { minivan: _m, business: _b, ...old } = DEFAULT_TARIFF.classes;
    const strip = ({ enabled: _e, ...c }: typeof old.economy) => c;
    return {
      ...DEFAULT_TARIFF,
      classes: { economy: strip(old.economy), comfort: strip(old.comfort) },
    };
  };

  it('has four classes, minivan and business switched off at launch', () => {
    expect(RIDE_CLASSES).toEqual(['economy', 'comfort', 'minivan', 'business']);
    expect(enabledClasses(DEFAULT_TARIFF)).toEqual(['economy', 'comfort']);
    expect(Tariff.parse(DEFAULT_TARIFF)).toEqual(DEFAULT_TARIFF);
  });

  it('prices minivan ~+40% and business ~+90% over economy', () => {
    const at = (rideClass: RideClass) => fare({ rideClass }).total;
    expect(at('economy')).toBe(7000);
    expect(at('minivan')).toBe(9800);
    expect(at('business')).toBe(13_300);
    expect(at('minivan') / at('economy')).toBeCloseTo(1.4, 1);
    expect(at('business') / at('economy')).toBeGreaterThanOrEqual(1.8);
  });

  it('reads a tariff stored before the new classes: they are derived from economy, off', () => {
    const t = Tariff.parse(stored());
    expect(t.classes.economy.enabled).toBe(true);
    expect(t.classes.comfort.enabled).toBe(true);
    expect(t.classes.minivan).toEqual(
      deriveClassTariff(DEFAULT_TARIFF.classes.economy, DERIVED_CLASS_PERCENT.minivan),
    );
    expect(t.classes.minivan.enabled).toBe(false);
    expect(t.classes.minivan.bands.map((b) => b.price)).toEqual([7000, 9800, 14_000]);
    expect(t.classes.business.bands.map((b) => b.price)).toEqual([9500, 13_300, 19_000]);
    expect(t.classes.business.intercity_min).toBe(47_500);
    // the launch defaults are exactly what an old document derives
    expect(t.classes.minivan).toEqual(DEFAULT_TARIFF.classes.minivan);
    expect(t.classes.business).toEqual(DEFAULT_TARIFF.classes.business);
    expect(enabledClasses(t)).toEqual(['economy', 'comfort']);
  });

  it('keeps a class operators switched on, and never lets economy be switched off', () => {
    const on = Tariff.parse({
      ...DEFAULT_TARIFF,
      classes: {
        ...DEFAULT_TARIFF.classes,
        minivan: { ...DEFAULT_TARIFF.classes.minivan, enabled: true },
        comfort: { ...DEFAULT_TARIFF.classes.comfort, enabled: false },
      },
    });
    expect(enabledClasses(on)).toEqual(['economy', 'minivan']);
    const noEconomy = Tariff.safeParse({
      ...DEFAULT_TARIFF,
      classes: {
        ...DEFAULT_TARIFF.classes,
        economy: { ...DEFAULT_TARIFF.classes.economy, enabled: false },
      },
    });
    expect(noEconomy.success).toBe(false);
  });
});
