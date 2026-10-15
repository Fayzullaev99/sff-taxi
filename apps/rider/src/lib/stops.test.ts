import { describe, expect, it } from 'vitest';
import type { Fare } from '../api/types';
import { MAX_STOPS, withStop } from '../trip/draft';
import { fareLines, stopRulesText, stopStateText } from './fare';

const s = (text: string) => text.replace(/\u00a0/g, ' ');
const point = (address: string) => ({ lat: 40.5, lng: 68.78, address });

describe('intermediate stops', () => {
  it('adds and replaces stops, never more than two', () => {
    expect(MAX_STOPS).toBe(2);
    const one = withStop([], 0, point('Dorixona'));
    const two = withStop(one, 1, point('Maktab'));
    expect(two.map((p) => p.address)).toEqual(['Dorixona', 'Maktab']);
    expect(withStop(two, 0, point('Bozor')).map((p) => p.address)).toEqual(['Bozor', 'Maktab']);
    expect(withStop(two, 2, point('Uchinchi'))).toHaveLength(2);
    expect(withStop([], 1, point('Bo‘shliq'))).toEqual([]);
  });

  it('shows the stops’ fees as their own line of the price', () => {
    const fare = {
      kind: 'city',
      rideClass: 'economy',
      distanceM: 5200,
      insideM: 5200,
      outsideM: 0,
      base: 10_000,
      outside: 0,
      night: 0,
      options: {},
      stops: { count: 2, fee: 2000 },
      total: 12_000,
      seat: null,
    } as Fare;
    const lines = fareLines(fare, 1500);
    expect(lines.map((l) => [s(l.label), l.amount])).toEqual([
      ['Shahar ichida, 5,2 km', 10_000],
      ['Oraliq manzillar × 2', 2000],
      ['Pullik kutish', 1500],
    ]);
  });

  it('explains the stop rules and each stop’s state', () => {
    expect(
      s(stopRulesText({ max: 2, perStop: 1000, freeMinutes: 3, waitingPerMinute: 500 })!),
    ).toBe(
      'Har bir oraliq manzil 1 000 so‘m. U yerda 3 daqiqa kutish bepul, keyin har daqiqa 500 so‘m. Manzillar buyurtmadan keyin o‘zgarmaydi.',
    );
    expect(stopRulesText(undefined)).toBeNull();
    expect(stopStateText({ arrivedAt: null, leftAt: null, waitingFee: 0 })).toBe('Oldinda');
    expect(stopStateText({ arrivedAt: 'x', leftAt: null, waitingFee: 0 })).toBe(
      'Mashina shu yerda kutmoqda',
    );
    expect(s(stopStateText({ arrivedAt: 'x', leftAt: 'y', waitingFee: 1500 }))).toBe(
      'O‘tildi · kutish 1 500 so‘m',
    );
  });
});
