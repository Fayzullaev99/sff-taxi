/**
 * The panel's side of wave 4 (docs/shared-rides.md): the shared-ride price formula (the API's
 * poolDiscount), the rules form, fixed route prices, deposits and shared cars on the live map.
 */
import { describe, expect, it } from 'vitest';
import type { AdminRideItem, LiveBoard, PoolRules, RideEvent } from '../api/types';
import {
  carLoad,
  depositFor,
  exampleProblems,
  FOUNDER_EXAMPLE,
  formToPool,
  mergeLiveDrivers,
  poolDiscount,
  poolExample,
  poolFormProblems,
  poolToForm,
  rideTags,
  routeFareBody,
  type RouteFareDraft,
  routeFareProblems,
  seatingText,
} from './pool';
import { eventDetail } from './rides';

const RULES: PoolRules = {
  enabled: true,
  discount_percent: 15,
  full_discount_share_percent: 50,
  max_detour_seconds_city: 360,
  max_detour_seconds_intercity: 900,
  max_detour_percent: 50,
  max_pickup_eta_seconds: 900,
  search_radius_m: 8000,
  pool_preference_seconds: 90,
  max_riders: 3,
};

describe('shared-ride prices', () => {
  it('matches the founder’s example: 85 000 + 34 000, the driver 119 000', () => {
    const r = poolExample(FOUNDER_EXAMPLE, RULES);
    expect(r.a).toEqual({ fare: 100_000, discount: 15_000, pays: 85_000 });
    expect(r.b).toEqual({ fare: 40_000, discount: 6000, pays: 34_000 });
    expect(r.driver).toBe(119_000);
  });

  it('gives a short shared part a proportional discount, in whole 100 so‘m', () => {
    // 5 km of a 40 km trip: a quarter of the full share (20 km) -> a quarter of 15%
    expect(poolDiscount(100_000, 40_000, 5000, RULES)).toBe(3700);
    expect(poolDiscount(100_000, 40_000, 0, RULES)).toBe(0);
    expect(poolDiscount(0, 40_000, 5000, RULES)).toBe(0);
    // never more than the fare
    expect(
      poolDiscount(1000, 1000, 1000, { discount_percent: 50, full_discount_share_percent: 1 }),
    ).toBe(500);
  });

  it('checks the calculator’s inputs', () => {
    expect(exampleProblems(FOUNDER_EXAMPLE)).toEqual({});
    expect(exampleProblems({ ...FOUNDER_EXAMPLE, fareA: null, sharedKm: 50 })).toEqual({
      fareA: 'Narxni kiriting',
      sharedKm: 'Umumiy qism safarlardan uzun bo‘lmaydi',
    });
  });
});

describe('shared-ride rules form', () => {
  it('shows minutes and sends seconds', () => {
    const form = poolToForm(RULES);
    expect(form.detour_city_min).toBe(6);
    expect(form.detour_intercity_min).toBe(15);
    expect(form.pickup_eta_min).toBe(15);
    expect(formToPool(form)).toEqual(RULES);
    expect(formToPool({ ...form, detour_city_min: 1.5 }).max_detour_seconds_city).toBe(90);
    expect(poolFormProblems(form)).toEqual({});
  });

  it('keeps the seating rule and the API’s limits', () => {
    const form = poolToForm(RULES);
    expect(poolFormProblems({ ...form, max_riders: 4 }).max_riders).toBe('2 dan 3 gacha');
    expect(poolFormProblems({ ...form, discount_percent: 60 }).discount_percent).toBe(
      '0 dan 50 gacha',
    );
    expect(poolFormProblems({ ...form, discount_percent: 12.5 }).discount_percent).toBe(
      'Butun son',
    );
    expect(poolFormProblems({ ...form, search_radius_m: null }).search_radius_m).toBe(
      'Qiymatni kiriting',
    );
    expect(
      poolFormProblems({ ...form, detour_city_min: 10, detour_intercity_min: 8 })
        .detour_intercity_min,
    ).toBe('Shaharlararo chegara shahardagidan kam bo‘lmasin');
  });

  it('describes where a party sits', () => {
    expect(seatingText(1)).toBe('1 kishi (old o‘rindiq)');
    expect(seatingText(3)).toBe('3 kishi (1 old, 2 orqa)');
    expect(seatingText(5)).toBe('3 kishi (1 old, 2 orqa)');
  });
});

describe('deposits', () => {
  it('takes the percent, at least the minimum, never more than the price', () => {
    const r = { deposit_percent: 20, deposit_min: 5000 };
    expect(depositFor(60_000, r)).toBe(12_000);
    expect(depositFor(10_000, r)).toBe(5000);
    expect(depositFor(3000, r)).toBe(3000);
    expect(depositFor(60_000, { ...r, deposit_percent: 0 })).toBe(0);
  });
});

describe('fixed route prices', () => {
  const draft: RouteFareDraft = {
    from: 'yangiyer',
    to: 'guliston',
    class: 'economy',
    seatPrice: 10_000,
    carPrice: 60_000,
    seatOn: true,
    carOn: false,
    isActive: true,
    bothWays: true,
  };

  it('sends only the prices ticked in', () => {
    expect(routeFareProblems(draft)).toEqual({});
    expect(routeFareBody(draft)).toEqual({
      from: 'yangiyer',
      to: 'guliston',
      class: 'economy',
      seatPrice: 10_000,
      carPrice: null,
      isActive: true,
      bothWays: true,
    });
  });

  it('follows the API’s rules', () => {
    expect(routeFareProblems({ ...draft, to: 'yangiyer' }).to).toBe(
      'Yo‘nalish bir joyda boshlanib tugamaydi',
    );
    expect(routeFareProblems({ ...draft, seatOn: false }).seatPrice).toBe(
      'O‘rindiq yoki butun mashina narxi kerak',
    );
    expect(routeFareProblems({ ...draft, seatPrice: 500 }).seatPrice).toBe(
      '1 000 dan 10 000 000 so‘mgacha',
    );
    expect(routeFareProblems({ ...draft, carOn: true, carPrice: 8000 }).carPrice).toBe(
      'Butun mashina bir o‘rindiqdan arzon bo‘lmaydi',
    );
  });
});

const ride = (over: Partial<AdminRideItem>) =>
  ({ id: 'r', number: 1, driverId: null, passengers: 1, pool: null, ...over }) as AdminRideItem;

const driver = (id: string, over: Partial<LiveBoard['drivers'][number]> = {}) => ({
  id,
  name: id,
  lat: 40.49,
  lng: 68.78,
  heading: null,
  locatedAt: '2026-09-29T07:00:00.000Z',
  onlineSince: null,
  plate: '20A123BC',
  class: 'economy' as const,
  rideId: null,
  rideStatus: null,
  offeredRideId: null,
  state: 'free' as const,
  ...over,
});

describe('shared cars on the live map', () => {
  it('merges the rows of a car carrying several rides', () => {
    const board: LiveBoard = {
      drivers: [
        driver('d1', { rideId: 'r1', rideStatus: 'in_progress', state: 'busy' }),
        driver('d2'),
        driver('d1', { rideId: 'r2', rideStatus: 'driver_assigned', state: 'busy' }),
      ],
      rides: [
        ride({ id: 'r1', driverId: 'd1', passengers: 2, pool: { id: 'p', sharedM: 100 } }),
        ride({ id: 'r2', driverId: 'd1', passengers: 1, pool: { id: 'p', sharedM: 0 } }),
      ],
    };
    const merged = mergeLiveDrivers(board);
    expect(merged.drivers.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(merged.drivers[0]).toMatchObject({ rideId: 'r1', rideIds: ['r1', 'r2'] });
    expect(merged.drivers[1]!.rideIds).toEqual([]);
    // a board already merged comes back as it is
    expect(mergeLiveDrivers(merged)).toBe(merged);
    expect(carLoad(merged, 'd1')).toMatchObject({ passengers: 3, shared: true });
    expect(carLoad(merged, 'd1').rides).toHaveLength(2);
    expect(carLoad(merged, 'd2')).toMatchObject({ passengers: 0, shared: false });
  });

  it('tags shared, women-only and per-seat rides', () => {
    expect(
      rideTags({ shareable: true, womenOnly: true, fareMode: 'seat' }).map((t) => t.label),
    ).toEqual(['Hamroh', 'Ayol haydovchi', 'O‘rindiq narxi']);
    expect(rideTags({})).toEqual([]);
  });
});

describe('shared-ride events', () => {
  const event = (type: string, data: Record<string, unknown>): RideEvent => ({
    id: 'e',
    type,
    actor: 'system',
    data,
    at: '2026-09-29T07:00:00.000Z',
  });

  it('reads a join and a leave with the shared km and the new price', () => {
    expect(
      eventDetail(
        event('pool_joined', {
          otherRideId: 'r2',
          sharedM: 20_000,
          discount: 15_000,
          pays: 85_000,
        }),
        () => null,
      ),
    ).toBe('boshqa yo‘lovchi qo‘shildi, birga 20,0 km, chegirma 15 000 so‘m, to‘laydi 85 000 so‘m');
    expect(
      eventDetail(
        event('pool_joined', { sharedM: 0, discount: 0, pays: 40_000, detourS: 180 }),
        () => null,
      ),
    ).toBe(
      'shu safar yo‘ldagi mashinaga qo‘shildi, birga 0 m, chegirma 0 so‘m, to‘laydi 40 000 so‘m, qo‘shimcha yo‘l 3 daq',
    );
    expect(eventDetail(event('pool_left', { otherRideId: 'r2' }), () => null)).toBe(
      'boshqa yo‘lovchi chiqdi',
    );
  });
});
