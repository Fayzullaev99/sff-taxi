import { describe, expect, it } from 'vitest';
import {
  bookingPrice,
  driverSeatPrices,
  priceBand,
  referenceSeatPrices,
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
