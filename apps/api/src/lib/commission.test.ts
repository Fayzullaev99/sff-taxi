import { describe, expect, it } from 'vitest';
import {
  type ChargeInput,
  rideCharges,
  tashkentDayStart,
  tashkentMonth,
  tashkentWeekStart,
} from './commission.js';

const rules = {
  promo_until: null,
  commission_percent: 5,
  daily_cap: 10_000,
  weekly_cap: 55_000,
  intercity_commission_percent: 5,
  intercity_trip_cap: 10_000,
  tax_percent: 1,
};
const at = new Date('2027-02-10T09:00:00Z');
const charge = (over: Partial<ChargeInput>) =>
  rideCharges({
    fare: 10_000,
    kind: 'city',
    completedAt: at,
    rules,
    hasPass: false,
    chargedToday: 0,
    chargedThisWeek: 0,
    ...over,
  });

describe('ride charges', () => {
  it('withholds 1% tax and takes 5% on a city ride', () => {
    expect(charge({})).toEqual({ tax: 100, commission: 500, note: null });
    expect(charge({ fare: 7300 })).toEqual({ tax: 73, commission: 365, note: null });
  });

  it('takes no commission during the promo, but still the tax', () => {
    const promo = { ...rules, promo_until: '2027-02-10' };
    expect(charge({ rules: promo })).toEqual({ tax: 100, commission: 0, note: 'promo' });
    // the promo ends with its Tashkent date: 00:30 on the 11th in Tashkent is past it
    expect(charge({ rules: promo, completedAt: new Date('2027-02-10T19:30:00Z') }).note).toBeNull();
  });

  it('takes nothing on city rides while a pass runs, but intercity is always charged', () => {
    expect(charge({ hasPass: true })).toEqual({ tax: 100, commission: 0, note: 'pass' });
    expect(charge({ hasPass: true, kind: 'intercity', fare: 51_000 })).toEqual({
      tax: 510,
      commission: 2550,
      note: null,
    });
  });

  it('caps commission per day and week', () => {
    expect(charge({ chargedToday: 9800 })).toEqual({
      tax: 100,
      commission: 200,
      note: 'daily_cap',
    });
    expect(charge({ chargedToday: 10_000 })).toMatchObject({ commission: 0, note: 'daily_cap' });
    expect(charge({ chargedThisWeek: 54_900 })).toMatchObject({
      commission: 100,
      note: 'weekly_cap',
    });
    expect(
      charge({ rules: { ...rules, daily_cap: 0, weekly_cap: 0 }, chargedToday: 1e6 }).commission,
    ).toBe(500);
  });

  it('caps intercity commission per ride', () => {
    expect(charge({ kind: 'intercity', fare: 300_000 })).toEqual({
      tax: 3000,
      commission: 10_000,
      note: 'trip_cap',
    });
  });
});

describe('Tashkent calendar', () => {
  it('starts days and Monday weeks at Tashkent midnight', () => {
    // Wednesday 10 Feb 2027, 14:00 in Tashkent
    expect(tashkentDayStart(at).toISOString()).toBe('2027-02-09T19:00:00.000Z');
    expect(tashkentWeekStart(at).toISOString()).toBe('2027-02-07T19:00:00.000Z');
    // Sunday late evening belongs to the week that began on Monday
    const sunday = new Date('2027-02-14T18:00:00Z');
    expect(tashkentWeekStart(sunday).toISOString()).toBe('2027-02-07T19:00:00.000Z');
    expect(tashkentWeekStart(new Date('2027-02-14T19:00:00Z')).toISOString()).toBe(
      '2027-02-14T19:00:00.000Z',
    );
    expect(tashkentMonth(new Date('2027-01-31T19:30:00Z'))).toBe('2027-02');
  });
});
