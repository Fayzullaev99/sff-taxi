import { describe, expect, it } from 'vitest';
import type { RideStop } from '../core/db/schema.js';
import {
  lockedStopCount,
  mergeStops,
  nextStopIndex,
  stopsChangeAllowed,
  stopsChangeCheck,
} from './stop-changes.js';

const stop = (lat: number, state: Partial<RideStop> = {}): RideStop => ({
  address: null,
  landmark: null,
  lat,
  lng: 68.78,
  arrivedAt: null,
  leftAt: null,
  waitingFee: 0,
  ...state,
});
const at = { arrivedAt: '2026-10-16T08:00:00Z' };
const passed = { ...at, leftAt: '2026-10-16T08:04:00Z', waitingFee: 500 };

const ride = (over: Partial<Parameters<typeof stopsChangeAllowed>[0]> = {}) => ({
  status: 'driver_assigned',
  service: 'taxi',
  shareable: false,
  fare_mode: 'car',
  payment_method: 'cash',
  pool_id: null,
  stops: [stop(40.1), stop(40.2)],
  ...over,
});

describe('the next stop on the trip', () => {
  it('is the first unvisited stop, the one the car stands at, then none (the drop-off)', () => {
    expect(nextStopIndex([])).toBeNull();
    expect(nextStopIndex([stop(1), stop(2)])).toBe(0);
    expect(nextStopIndex([stop(1, at), stop(2)])).toBe(0);
    expect(nextStopIndex([stop(1, passed), stop(2)])).toBe(1);
    expect(nextStopIndex([stop(1, passed), stop(2, at)])).toBe(1);
    expect(nextStopIndex([stop(1, passed), stop(2, passed)])).toBeNull();
  });

  it('treats a skipped stop as behind once a later one was reached', () => {
    expect(nextStopIndex([stop(1), stop(2, at)])).toBe(1);
    expect(nextStopIndex([stop(1), stop(2, passed)])).toBeNull();
  });
});

describe('changing the stops of a ride', () => {
  it('locks every stop up to the last one the car reached', () => {
    expect(lockedStopCount([])).toBe(0);
    expect(lockedStopCount([stop(1), stop(2)])).toBe(0);
    expect(lockedStopCount([stop(1, at), stop(2)])).toBe(1);
    expect(lockedStopCount([stop(1), stop(2, at)])).toBe(2);
  });

  it('is for cash taxi rides that are on, never shared or by card', () => {
    expect(stopsChangeAllowed(ride())).toBeNull();
    expect(stopsChangeAllowed(ride({ status: 'scheduled' }))).toBeNull();
    expect(stopsChangeAllowed(ride({ status: 'in_progress' }))).toBeNull();
    expect(stopsChangeAllowed(ride({ status: 'completed' }))).toBe('status');
    expect(stopsChangeAllowed(ride({ status: 'awaiting_payment' }))).toBe('status');
    expect(stopsChangeAllowed(ride({ service: 'cargo' }))).toBe('service');
    expect(stopsChangeAllowed(ride({ service: 'delivery' }))).toBe('service');
    expect(stopsChangeAllowed(ride({ shareable: true }))).toBe('shared');
    expect(stopsChangeAllowed(ride({ fare_mode: 'seat' }))).toBe('shared');
    expect(stopsChangeAllowed(ride({ pool_id: 'p1' }))).toBe('shared');
    expect(stopsChangeAllowed(ride({ payment_method: 'card' }))).toBe('card');
  });

  it('keeps the reached stops, allows at most two and wants a difference', () => {
    const r = ride({ status: 'in_progress', stops: [stop(40.1, passed), stop(40.2)] });
    expect(stopsChangeCheck(r, [stop(40.1), stop(40.3)])).toBeNull();
    expect(stopsChangeCheck(r, [stop(40.1)])).toBeNull();
    expect(stopsChangeCheck(r, [])).toBe('locked');
    expect(stopsChangeCheck(r, [stop(40.5), stop(40.2)])).toBe('locked');
    expect(stopsChangeCheck(r, [stop(40.1), stop(40.2)])).toBe('unchanged');
    expect(stopsChangeCheck(ride(), [stop(1), stop(2), stop(3)])).toBe('too_many');
    expect(stopsChangeCheck(ride({ stops: [] }), [])).toBe('unchanged');
    expect(stopsChangeCheck(ride({ stops: [] }), [stop(40.9)])).toBeNull();
    expect(stopsChangeCheck(ride(), [])).toBeNull();
  });

  it('merges: the fixed prefix keeps its times, the rest are new', () => {
    const current = [stop(40.1, passed), stop(40.2)];
    const next = mergeStops(current, [
      { lat: 40.1, lng: 68.78, address: 'Eski', landmark: null },
      { lat: 40.3, lng: 68.79, address: 'Maktab', landmark: 'Darvoza' },
    ]);
    expect(next[0]).toBe(current[0]);
    expect(next[1]).toEqual({
      address: 'Maktab',
      landmark: 'Darvoza',
      lat: 40.3,
      lng: 68.79,
      arrivedAt: null,
      leftAt: null,
      waitingFee: 0,
    });
  });
});
