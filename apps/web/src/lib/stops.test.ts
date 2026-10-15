import { describe, expect, it } from 'vitest';
import { eventDetail, routePoints, stopState } from './rides';

describe('intermediate stops for operators', () => {
  it('says where the car is with each stop', () => {
    expect(
      stopState({
        address: 'Dorixona',
        landmark: null,
        lat: 1,
        lng: 2,
        arrivedAt: null,
        leftAt: null,
        waitingFee: 0,
      }),
    ).toBe('oldinda');
    expect(
      stopState({
        address: null,
        landmark: null,
        lat: 1,
        lng: 2,
        arrivedAt: '2026-10-15T07:00:00Z',
        leftAt: null,
        waitingFee: 0,
      }),
    ).toBe('mashina shu yerda (12:00 dan)');
    expect(
      stopState({
        address: null,
        landmark: null,
        lat: 1,
        lng: 2,
        arrivedAt: '2026-10-15T07:00:00Z',
        leftAt: '2026-10-15T07:06:00Z',
        waitingFee: 1500,
      }).replace(/\u00a0/g, ' '),
    ).toBe('o‘tdi 12:06 · kutish 1 500 so‘m');
  });

  it('draws the route through the stops and labels the stop events', () => {
    const a = { lat: 1, lng: 1 };
    const b = { lat: 2, lng: 2 };
    const s = { lat: 1.5, lng: 1.5 };
    expect(routePoints({ pickup: a, dropoff: b, stops: [s] })).toEqual([a, s, b]);
    expect(routePoints({ pickup: a, dropoff: b })).toEqual([a, b]);
    const e = (data: Record<string, unknown>) => ({
      id: 'e',
      type: 'stop_left',
      actor: 'driver' as const,
      data,
      at: '2026-10-15T07:06:00Z',
    });
    expect(eventDetail(e({ index: 0, waitingFee: 1500 }), () => null).replace(/\u00a0/g, ' ')).toBe(
      '1-oraliq manzil, pullik kutish 1 500 so‘m',
    );
  });
});
