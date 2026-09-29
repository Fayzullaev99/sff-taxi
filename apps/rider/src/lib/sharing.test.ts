import { describe, expect, it } from 'vitest';
import type { PoolCar, Quote, RouteFare } from '../api/types';
import {
  clampPassengers,
  depositPayment,
  freeSeats,
  genderLock,
  occupancyText,
  orderChoices,
  pinDigits,
  poolCarsFor,
  poolCarsHeadline,
  poolCarText,
  ridePrice,
  routeChipLabel,
  routeChips,
  routePrices,
  seatMap,
  seatTotal,
  sharedFloor,
  shareToggleText,
  womenDriversText,
} from './sharing';

const N = ' ';
const car = (over: Partial<PoolCar> = {}): PoolCar => ({
  etaS: 170,
  detourS: 60,
  inCar: 1,
  occupied: 1,
  capacity: 3,
  front: 1,
  rear: 0,
  free: 2,
  ...over,
});

describe('seats', () => {
  it('keeps 1–3 people, lower when the quote says so', () => {
    expect(clampPassengers(0)).toBe(1);
    expect(clampPassengers(5)).toBe(3);
    expect(clampPassengers(2, { seats: { max: 3, front: 1, rearMax: 2 } })).toBe(2);
    expect(clampPassengers(3, { seats: { max: 2, front: 1, rearMax: 1 } })).toBe(2);
    expect(clampPassengers(2, {})).toBe(2);
  });

  it('knows the free seats by place and draws the car front first', () => {
    // one person in front: the two back seats are free
    expect(freeSeats(car())).toEqual({ front: 0, rear: 2 });
    expect(freeSeats(car({ front: 1, rear: 1, occupied: 2, free: 1 }))).toEqual({
      front: 0,
      rear: 1,
    });
    expect(freeSeats(car({ front: 0, rear: 0, occupied: 0, free: 3 }))).toEqual({
      front: 1,
      rear: 2,
    });
    expect(seatMap(car({ front: 1, rear: 1 }))).toEqual([
      { place: 'front', taken: true },
      { place: 'rear', taken: true },
      { place: 'rear', taken: false },
    ]);
  });
});

describe('cars already going the rider’s way', () => {
  it('says who is inside, the free seats by place and the ETA', () => {
    expect(poolCarText(car())).toBe(`ichida 1 kishi, 2 bo‘sh joy (orqada 2), ~3${N}daq`);
    expect(poolCarText(car({ inCar: 0, front: 1, rear: 0, free: 2, etaS: 60 }))).toBe(
      `hozircha bo‘sh, 2 bo‘sh joy (orqada 2), ~1${N}daq`,
    );
    expect(poolCarText(car({ front: 0, rear: 1, free: 2 }))).toBe(
      `ichida 1 kishi, 2 bo‘sh joy (oldinda 1 · orqada 1), ~3${N}daq`,
    );
  });

  it('shows only cars with room for everyone, nearest first', () => {
    const cars = [car({ etaS: 400 }), car({ etaS: 100, free: 1 }), car({ etaS: 200 })];
    expect(poolCarsFor(cars, 2).map((c) => c.etaS)).toEqual([200, 400]);
    expect(poolCarsFor(cars, 1).map((c) => c.etaS)).toEqual([100, 200, 400]);
    expect(poolCarsFor(undefined, 1)).toEqual([]);
    expect(poolCarsHeadline(cars, 2)).toBe('Yo‘lingizda mashina bor');
    expect(poolCarsHeadline([], 1)).toContain('bo‘sh mashina keladi');
  });

  it('words the toggle and the lowest price', () => {
    expect(shareToggleText(15)).toBe(
      'Boshqa yo‘lovchini olishga roziman — narx ~15% gacha arzonlashadi',
    );
    expect(shareToggleText(0)).toBe('Boshqa yo‘lovchini olishga roziman');
    expect(sharedFloor(10_000, 15)).toBe(8_500);
  });
});

describe('a woman driver', () => {
  it('says how many are near, or that the wait may be longer', () => {
    expect(womenDriversText({ cars: 2, etaS: 240 })).toBe(
      `Yaqinda 2 ta ayol haydovchi · eng yaqini ~4${N}daq`,
    );
    expect(womenDriversText({ cars: 0, etaS: null })).toContain('ayol haydovchi yo‘q');
    expect(womenDriversText(null)).toBeNull();
  });
});

const quote = (over: Partial<Quote> = {}) =>
  ({
    seats: { max: 3, front: 1, rearMax: 2 },
    route: {
      from: { slug: 'yangiyer', name: 'Yangiyer' },
      to: { slug: 'guliston', name: 'Guliston' },
      prices: { economy: { seat: 10_000, car: 40_000 }, comfort: { seat: null, car: 50_000 } },
    },
    pool: {
      available: true,
      discountPercent: 15,
      fullDiscountSharePercent: 50,
      cashOnly: true,
      cars: [],
    },
    womenOnly: { available: false, reason: 'profile_gender', drivers: null },
    ...over,
  }) as Quote;

describe('fixed route prices', () => {
  it('reads a class’s seat and whole-car price', () => {
    expect(routePrices(quote(), 'economy')).toEqual({ seat: 10_000, car: 40_000 });
    expect(routePrices(quote(), 'comfort')).toEqual({ seat: null, car: 50_000 });
    expect(routePrices(quote({ route: null }), 'economy')).toBeNull();
    expect(routePrices({}, 'economy')).toBeNull();
  });

  it('prices seats like the API: seat × people + options, up to 100', () => {
    expect(seatTotal(10_000, 2, {})).toBe(20_000);
    expect(seatTotal(10_000, 1, { child_seat: 2_050 })).toBe(12_100);
  });
});

describe('what the order sends', () => {
  const base = {
    passengers: 2,
    shareable: false,
    womenOnly: false,
    fareMode: 'car' as const,
    paymentMethod: 'card' as const,
  };

  it('a seat is a shared cash ride, only where the route has a seat price', () => {
    expect(orderChoices({ ...base, fareMode: 'seat' }, quote(), 'economy')).toEqual({
      ...base,
      fareMode: 'seat',
      shareable: true,
      paymentMethod: 'cash',
    });
    expect(orderChoices({ ...base, fareMode: 'seat' }, quote(), 'comfort').fareMode).toBe('car');
  });

  it('sharing only where offered, and in cash', () => {
    const on = orderChoices({ ...base, shareable: true }, quote(), 'economy');
    expect([on.shareable, on.paymentMethod]).toEqual([true, 'cash']);
    const off = orderChoices(
      { ...base, shareable: true },
      quote({ pool: { ...quote().pool!, available: false } }),
      'economy',
    );
    expect([off.shareable, off.paymentMethod]).toEqual([false, 'card']);
  });

  it('a woman driver only where offered; an older API gets the plain order', () => {
    expect(orderChoices({ ...base, womenOnly: true }, quote(), 'economy').womenOnly).toBe(false);
    const women = quote({ womenOnly: { available: true, reason: null, drivers: null } });
    expect(orderChoices({ ...base, womenOnly: true }, women, 'economy').womenOnly).toBe(true);
    expect(orderChoices({ ...base, shareable: true, fareMode: 'seat' }, {}, 'economy')).toEqual({
      ...base,
      shareable: false,
      fareMode: 'car',
    });
  });
});

describe('on the ride', () => {
  it('spaces the start code for reading aloud', () => {
    expect(pinDigits('4812')).toBe('4 8 1 2');
    expect(pinDigits(null)).toBeNull();
    expect(pinDigits('ab12')).toBeNull();
  });

  it('says who is in the car', () => {
    expect(occupancyText({ inCar: 2, free: 1 })).toBe('Mashinada 2 kishi · 1 bo‘sh joy');
    expect(occupancyText({ inCar: 3, free: 0 })).toBe('Mashinada 3 kishi · bo‘sh joy yo‘q');
    expect(occupancyText(null)).toBeNull();
  });

  it('works out the shared price, the deposit and the cash left', () => {
    expect(ridePrice({ quoted: 100_000, poolDiscount: 15_000, pays: 85_000 })).toEqual({
      quoted: 100_000,
      pays: 85_000,
      discount: 15_000,
      deposit: 0,
      cashLeft: 85_000,
    });
    // an older API: no discount fields
    expect(ridePrice({ quoted: 20_000 })).toMatchObject({ pays: 20_000, discount: 0 });
    expect(ridePrice({ quoted: 30_000, deposit: 6_000 })).toMatchObject({ cashLeft: 24_000 });
  });
});

describe('route chips on the map', () => {
  const town = (slug: string, name: string, lat: number, lng: number) => ({ slug, name, lat, lng });
  const guliston = town('guliston', 'Guliston', 40.49, 68.78);
  const yangiyer = town('yangiyer', 'Yangiyer', 40.27, 68.82);
  const toshkent = town('toshkent', 'Toshkent', 41.31, 69.28);
  const route = (id: string, from: typeof guliston, to: typeof guliston, over = {}): RouteFare => ({
    id,
    class: 'economy',
    seatPrice: 10_000,
    carPrice: 40_000,
    from,
    to,
    ...over,
  });

  it('labels a route by its seat price, else the whole car', () => {
    expect(routeChipLabel(route('1', yangiyer, guliston))).toBe(
      `Yangiyer → Guliston · 10${N}000/kishi`,
    );
    expect(routeChipLabel(route('1', yangiyer, guliston, { seatPrice: null }))).toBe(
      `Yangiyer → Guliston · 40${N}000${N}so‘m`,
    );
  });

  it('offers routes from the rider’s town only, one per destination', () => {
    const routes = [
      route('a', guliston, toshkent, { seatPrice: 70_000 }),
      route('b', yangiyer, guliston),
      route('c', guliston, yangiyer),
      route('d', guliston, yangiyer, { class: 'comfort' }),
      route('e', guliston, toshkent, { seatPrice: null, carPrice: null }),
    ];
    const inGuliston = { lat: 40.5, lng: 68.77 };
    expect(routeChips(routes, inGuliston).map((c) => c.key)).toEqual(['a', 'c']);
    const inYangiyer = { lat: 40.27, lng: 68.82 };
    expect(routeChips(routes, inYangiyer)).toEqual([
      {
        key: 'b',
        label: `Yangiyer → Guliston · 10${N}000/kishi`,
        to: { lat: 40.49, lng: 68.78, name: 'Guliston' },
        seat: true,
      },
    ]);
    expect(routeChips(routes, null)).toEqual([]);
    expect(routeChips(undefined, inGuliston)).toEqual([]);
  });
});

describe('the declared gender', () => {
  const now = new Date('2026-09-29T09:00:00Z');
  it('can be changed when not locked', () => {
    expect(genderLock(null, now)).toEqual({ locked: false, text: null });
    expect(genderLock('2026-09-01T00:00:00Z', now).locked).toBe(false);
  });

  it('says from which day it can be changed again', () => {
    const lock = genderLock('2026-10-20T10:00:00Z', now);
    expect(lock.locked).toBe(true);
    expect(lock.text).toContain('20 oktabr');
  });
});

describe('a deposit for a ride booked for later', () => {
  it('is the amount asked now and the cash left for the driver', () => {
    expect(
      depositPayment({ payment: { amount: 6_000 }, fare: { quoted: 30_000, deposit: 6_000 } }),
    ).toEqual({ amount: 6_000, cashLeft: 24_000 });
    expect(depositPayment({ payment: null, fare: { quoted: 30_000, deposit: 6_000 } })).toEqual({
      amount: 6_000,
      cashLeft: 24_000,
    });
  });

  it('is not an ordinary card ride paying its whole fare', () => {
    expect(depositPayment({ payment: { amount: 30_000 }, fare: { quoted: 30_000 } })).toBeNull();
    expect(
      depositPayment({ payment: { amount: 30_000 }, fare: { quoted: 30_000, deposit: 0 } }),
    ).toBeNull();
  });
});
