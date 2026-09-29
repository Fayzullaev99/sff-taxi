import { describe, expect, it } from 'vitest';
import {
  alongStops,
  alongTheWayShare,
  bookingPrice,
  driverSeatPrices,
  fractionAlong,
  partSeatPrice,
  partSeatPrices,
  priceBand,
  referenceSeatPrices,
  seatingError,
  wholeCarFare,
} from './intercity.js';
import { DEFAULT_TARIFF } from './tariff.js';

describe('intercity seat prices', () => {
  it('shares the whole-car fare per seat, the front seat 10% dearer', () => {
    // Guliston -> Yangiyer, ~33 km by road: 33 x 1 700 = 56 100 for the car
    expect(wholeCarFare(32_400, DEFAULT_TARIFF, 'economy')).toBe(56_100);
    expect(referenceSeatPrices(32_400, DEFAULT_TARIFF, 'economy')).toEqual({
      rear: 16_900, // 30%, rounded up to 100
      front: 18_600,
    });
    // short hops pay the minimum fare's share
    expect(referenceSeatPrices(9_000, DEFAULT_TARIFF, 'economy')).toEqual({
      rear: 7_500,
      front: 8_300,
    });
  });

  it('uses the operators’ route price, comfort in the tariff’s proportion', () => {
    const route = { rear: 70_000, front: 80_000 };
    expect(referenceSeatPrices(120_000, DEFAULT_TARIFF, 'economy', route)).toEqual(route);
    // comfort 2 100 / economy 1 700 per km
    expect(referenceSeatPrices(120_000, DEFAULT_TARIFF, 'comfort', route)).toEqual({
      rear: 86_500,
      front: 98_900,
    });
  });

  it('lets drivers ask within ±15%, the front seat keeping its proportion', () => {
    expect(priceBand(70_000, 15)).toEqual({ min: 59_500, max: 80_500 });
    expect(priceBand(16_900, 15)).toEqual({ min: 14_400, max: 19_400 });
    expect(driverSeatPrices({ rear: 70_000, front: 80_000 }, 63_000)).toEqual({
      rear: 63_000,
      front: 72_000,
    });
  });

  it('prices a booking of several seats', () => {
    const p = { rear: 70_000, front: 80_000 };
    expect(bookingPrice(1, false, p)).toBe(70_000);
    expect(bookingPrice(1, true, p)).toBe(80_000);
    expect(bookingPrice(3, true, p)).toBe(220_000);
  });
});

describe('the seating rule on the trip board', () => {
  it('offers at most 1 front and 2 rear seats', () => {
    expect(seatingError(3, true)).toBeNull();
    expect(seatingError(2, false)).toBeNull();
    expect(seatingError(1, false)).toBeNull();
    expect(seatingError(3, false)).toMatch(/Orqa o‘rindiqqa 2 tadan ortiq/);
    expect(seatingError(4, true)).toMatch(/ko‘pi bilan 3/);
  });
});

describe('seats along the way', () => {
  // the towns' centres (migrations/0002_geo.sql, 0009_intercity.sql)
  const guliston = { lat: 40.4959816, lng: 68.7758675 };
  const sirdaryo = { lat: 40.8309135, lng: 68.6661865 };
  const baxt = { lat: 40.7204398, lng: 68.6926186 };
  const shirin = { lat: 40.2302986, lng: 69.1263086 };
  const toshkent = { lat: 41.2995, lng: 69.2401 };

  it('finds riders whose towns the trip passes, in its direction', () => {
    // Guliston -> Toshkent goes through Sirdaryo: ~12 km more by straight lines
    const fromSirdaryo = alongTheWayShare(guliston, toshkent, sirdaryo, toshkent, 15);
    expect(fromSirdaryo).toBeCloseTo(0.727, 2);
    expect(alongTheWayShare(guliston, toshkent, guliston, sirdaryo, 15)).toBeCloseTo(0.394, 2);
    // the other way round, too far aside, too short a part, a narrower corridor
    expect(alongTheWayShare(guliston, toshkent, toshkent, sirdaryo, 15)).toBeNull();
    expect(alongTheWayShare(guliston, toshkent, shirin, toshkent, 15)).toBeNull();
    expect(alongTheWayShare(guliston, toshkent, guliston, baxt, 15)).toBeNull();
    expect(alongTheWayShare(guliston, toshkent, sirdaryo, toshkent, 4)).toBeNull();
    expect(alongTheWayShare(guliston, toshkent, guliston, toshkent, 0)).toBe(1);
  });

  it('prices part of a trip in proportion, at least 30% of the seat', () => {
    // 70 000 x 0.727 = 50 890 -> 51 000
    expect(partSeatPrice(70_000, 0.727)).toBe(51_000);
    expect(partSeatPrice(70_000, 0.3)).toBe(21_000);
    expect(partSeatPrice(70_000, 0.1)).toBe(21_000);
    expect(partSeatPrice(70_500, 0.9999)).toBe(70_500);
    expect(partSeatPrices({ rear: 70_000, front: 80_000 }, 0.394)).toEqual({
      rear: 28_000,
      front: 32_000,
    });
    expect(partSeatPrices({ rear: 70_000, front: 80_000 }, 1)).toEqual({
      rear: 70_000,
      front: 80_000,
    });
  });

  it('says where and about when an along-the-way rider gets in, and their part', () => {
    expect(fractionAlong(guliston, toshkent, guliston)).toBe(0);
    expect(fractionAlong(guliston, toshkent, toshkent)).toBe(1);
    expect(fractionAlong(guliston, toshkent, sirdaryo)).toBeCloseTo(0.35, 2);
    const trip = {
      start: guliston,
      end: toshkent,
      departureAt: new Date('2026-10-01T03:00:00Z'), // 08:00 in Tashkent
      distanceM: 132_000,
      durationS: 8_340, // ~2 h 19 min
    };
    // Sirdaryo -> Toshkent: the car passes Sirdaryo ~49 min after leaving, rounded to 08:50
    const s = alongStops(trip, sirdaryo, toshkent);
    expect(s.boardingAt.toISOString()).toBe('2026-10-01T03:50:00.000Z');
    expect(s.partDistanceM).toBe(85_700);
    // the trip's own ends: departure and the whole way
    const whole = alongStops(trip, guliston, toshkent);
    expect(whole.boardingAt).toEqual(trip.departureAt);
    expect(whole.partDistanceM).toBe(132_000);
    // Guliston -> Sirdaryo: from the start, about a third of the way
    expect(alongStops(trip, guliston, sirdaryo).partDistanceM).toBe(46_300);
  });
});
