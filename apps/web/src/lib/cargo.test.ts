/**
 * Cargo, delivery and deposits in the panel (docs/shared-rides.md §7–8, docs/payments.md):
 * the cargo price as the API computes it, the settings rules, services on the live board,
 * trip-board deposits and refunds of booking deposits.
 */
import { describe, expect, it } from 'vitest';
import type { AdminRideItem, CargoRules, LiveBoard } from '../api/types';
import { awaitingDeposit, cargoPrice, cargoProblems, suggestedCargoClass } from './cargo';
import { bookingMoney, canCancelBooking, holdsSeats } from './intercity';
import { refundSubject } from './payments';
import { depositFor, rideTags } from './pool';
import { DEFAULT_LIVE_FILTERS, filterLive } from './rides';

const RULES: CargoRules = {
  enabled: true,
  classes: {
    cargo_s: {
      base: 35_000,
      included_km: 10,
      included_minutes: 20,
      per_km: 1500,
      intercity_per_km: 1500,
      per_minute: 300,
      max_payload_kg: 700,
    },
    cargo_m: {
      base: 56_000,
      included_km: 10,
      included_minutes: 20,
      per_km: 2400,
      intercity_per_km: 2000,
      per_minute: 400,
      max_payload_kg: 1500,
    },
  },
  loader_price: 30_000,
  max_loaders: 2,
  night: { percent: 20, from: '23:00', to: '06:00' },
  intercity_from_km: 20,
  delivery: { enabled: true, percent: 100, max_weight_kg: 10 },
};

describe('cargo prices', () => {
  it('includes the first km, then per started km, loaders apart from the night add-on', () => {
    expect(
      cargoPrice({ cargoClass: 'cargo_s', km: 8, loaders: 0, night: false }, RULES).total,
    ).toBe(35_000);
    // 15 km: 5 km beyond × 1 500, one loader
    expect(
      cargoPrice({ cargoClass: 'cargo_s', km: 15, loaders: 1, night: false }, RULES),
    ).toMatchObject({
      kind: 'city',
      extraKm: 5,
      distance: 7500,
      loadersTotal: 30_000,
      total: 72_500,
    });
    // a started km counts; night +20% of the ride, not of the loaders; loaders capped at 2
    const night = cargoPrice({ cargoClass: 'cargo_s', km: 10.2, loaders: 5, night: true }, RULES);
    expect(night).toMatchObject({ extraKm: 1, night: 7300, loaders: 2, total: 103_800 });
  });

  it('uses the intercity per-km price from its distance', () => {
    const p = cargoPrice({ cargoClass: 'cargo_m', km: 40, loaders: 0, night: false }, RULES);
    expect(p).toMatchObject({ kind: 'intercity', perKm: 2000, total: 116_000 });
  });

  it('checks the API’s limits', () => {
    expect(cargoProblems(RULES)).toEqual({});
    const bad = cargoProblems({
      ...RULES,
      max_loaders: 5,
      night: { ...RULES.night, from: '25:00' },
      classes: {
        ...RULES.classes,
        cargo_s: { ...RULES.classes.cargo_s, included_minutes: 45 },
        cargo_m: { ...RULES.classes.cargo_m, max_payload_kg: 600 },
      },
      delivery: { ...RULES.delivery, percent: null },
    });
    expect(bad).toEqual({
      max_loaders: '0 dan 4 gacha',
      'night.from': 'SS:DD',
      'classes.cargo_s.included_minutes': '0 dan 30 gacha',
      'classes.cargo_m.max_payload_kg': 'O‘rta sinf kichigidan kam ko‘tarmaydi',
      'delivery.percent': 'Qiymatni kiriting',
    });
  });

  it('suggests the class of a cargo car by its payload', () => {
    expect(suggestedCargoClass(800)).toBe('cargo_s');
    expect(suggestedCargoClass(801)).toBe('cargo_m');
  });
});

const ride = (over: Partial<AdminRideItem>) =>
  ({
    id: 'r',
    number: 1,
    status: 'searching',
    class: 'economy',
    driverId: null,
    attentionAt: null,
    requestedAt: '2026-09-29T07:00:00.000Z',
    scheduledFor: null,
    fare: { quoted: 20_000, deposit: 0 },
    ...over,
  }) as AdminRideItem;

describe('services and deposits on rides', () => {
  it('tags cargo, deliveries and rides for later waiting for their deposit', () => {
    const later = ride({
      service: 'delivery',
      status: 'awaiting_payment',
      scheduledFor: '2026-09-29T12:00:00.000Z',
      fare: { quoted: 20_000, deposit: 5000 } as AdminRideItem['fare'],
    });
    expect(awaitingDeposit(later)).toBe(true);
    expect(rideTags(later).map((t) => t.label)).toEqual(['Yetkazish', 'Depozit kutilmoqda']);
    expect(rideTags(ride({ service: 'cargo' })).map((t) => t.label)).toEqual(['Yuk']);
    // a card ride now (not for later) waits for its payment, not a deposit
    expect(awaitingDeposit(ride({ status: 'awaiting_payment' }))).toBe(false);
    expect(rideTags(ride({ service: 'taxi' }))).toEqual([]);
  });

  it('rounds a deposit up to whole 1 000 so‘m (the API’s depositAmount)', () => {
    const r = { deposit_percent: 20, deposit_min: 5000 };
    expect(depositFor(56_000, r)).toBe(12_000);
    expect(depositFor(70_000, r)).toBe(14_000);
  });
});

describe('cargo cars on the live map', () => {
  const car = (id: string, cargoClass: 'cargo_s' | null) => ({
    id,
    name: id,
    lat: 40.49,
    lng: 68.78,
    heading: null,
    locatedAt: null,
    onlineSince: null,
    plate: '20A123BC',
    class: 'economy' as const,
    cargoClass,
    rideId: null,
    rideStatus: null,
    offeredRideId: null,
    state: 'free' as const,
  });
  const board: LiveBoard = {
    drivers: [car('taxi', null), car('van', 'cargo_s')],
    rides: [
      ride({ id: 't' }),
      ride({ id: 'c', service: 'cargo' }),
      ride({ id: 'd', service: 'delivery' }),
    ],
  };

  it('splits cargo cars and rides from taxi ones', () => {
    const cargo = filterLive(board, { ...DEFAULT_LIVE_FILTERS, fleet: 'cargo' });
    expect(cargo.drivers.map((d) => d.id)).toEqual(['van']);
    expect(cargo.rides.map((r) => r.id)).toEqual(['c']);
    const taxi = filterLive(board, { ...DEFAULT_LIVE_FILTERS, fleet: 'taxi' });
    expect(taxi.drivers.map((d) => d.id)).toEqual(['taxi']);
    expect(taxi.rides.map((r) => r.id)).toEqual(['t', 'd']);
    expect(filterLive(board, DEFAULT_LIVE_FILTERS).drivers).toHaveLength(2);
  });
});

describe('trip-board deposits', () => {
  it('splits a booking into the card deposit and the cash to the driver', () => {
    expect(bookingMoney({ price: 140_000, depositAmount: 28_000, payCash: 112_000 })).toEqual({
      deposit: 28_000,
      cash: 112_000,
    });
    // an older API: all of it cash
    expect(bookingMoney({ price: 70_000 })).toEqual({ deposit: 0, cash: 70_000 });
  });

  it('holds seats while the deposit is paid; operators may cancel such a booking', () => {
    expect(holdsSeats('awaiting_payment') && canCancelBooking('awaiting_payment')).toBe(true);
    expect(canCancelBooking('boarded') || holdsSeats('cancelled')).toBe(false);
  });

  it('names what a refund is for', () => {
    expect(
      refundSubject({ rideId: 'r1', rideNumber: 990, bookingId: null, bookingNumber: null }),
    ).toEqual({ label: '#990', to: '/rides/r1' });
    expect(
      refundSubject({ rideId: null, rideNumber: null, bookingId: 'b1', bookingNumber: 77 }),
    ).toEqual({ label: 'bron #77 (depozit)', to: null });
  });
});
