import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/dictionary';
import { nextStop, stopList, type StopRide, stopsFromPool, viaAction } from './stops';

const place = (name: string) => ({ lat: 40.49, lng: 68.78, address: name, landmark: null });

function ride(id: string, status: string): StopRide {
  return {
    id,
    number: 100,
    status,
    pickup: place(`${id} pickup`),
    dropoff: place(`${id} dropoff`),
    distanceM: 3_000,
  };
}

describe('stopList', () => {
  it('one ride: the pickup first, then the drop-off once the rider is in', () => {
    const toPickup = stopList([ride('a', 'driver_assigned')]);
    expect(toPickup.map((s) => [s.kind, s.current, s.done])).toEqual([
      ['pickup', true, false],
      ['dropoff', false, false],
    ]);
    expect(nextStop(stopList([ride('a', 'driver_arrived')]))?.kind).toBe('pickup');
    const onTrip = stopList([ride('a', 'in_progress')]);
    expect(nextStop(onTrip)?.kind).toBe('dropoff');
    expect(onTrip[0]!.done).toBe(true);
    expect(nextStop(stopList([ride('a', 'completed')]))).toBeNull();
  });

  it('several rides follow a route order when one is given', () => {
    const stops = stopList(
      [ride('a', 'in_progress'), ride('b', 'driver_assigned')],
      ['a:pickup', 'b:pickup', 'a:dropoff', 'b:dropoff'],
    );
    expect(stops.map((s) => s.key)).toEqual(['a:pickup', 'b:pickup', 'a:dropoff', 'b:dropoff']);
    expect(nextStop(stops)?.key).toBe('b:pickup');
  });
});

describe('stopsFromPool', () => {
  it('keeps the API order, the first stop current', () => {
    const stops = stopsFromPool([
      {
        rideId: 'b',
        number: 7,
        type: 'pickup',
        lat: 1,
        lng: 2,
        place: { address: 'Bozor', landmark: null },
        riderName: 'Aziza',
        passengers: 2,
        status: 'driver_assigned',
      },
      { rideId: 'a', type: 'dropoff', lat: 3, lng: 4, place: null, status: 'in_progress' },
    ]);
    expect(stops.map((s) => [s.key, s.current, s.passengers])).toEqual([
      ['b:pickup', true, 2],
      ['a:dropoff', false, 1],
    ]);
    expect(nextStop(stops)?.riderName).toBe('Aziza');
    expect(stops[1]!.place.address).toBeNull();
  });
});

describe('intermediate stops', () => {
  const via = (arrivedAt: string | null, leftAt: string | null) => ({
    ...place('stop'),
    arrivedAt,
    leftAt,
  });
  const withStops = (status: string, stops: ReturnType<typeof via>[]): StopRide => ({
    ...ride('v', status),
    stops,
  });
  const T = '2026-10-15T10:00:00Z';

  it('puts the stops between the pickup and the drop-off, in order', () => {
    const stops = stopList([withStops('in_progress', [via(null, null), via(null, null)])]);
    expect(stops.map((s) => [s.kind, s.index ?? null, s.current, s.done])).toEqual([
      ['pickup', null, false, true],
      ['via', 0, true, false],
      ['via', 1, false, false],
      ['dropoff', null, false, false],
    ]);
    expect(viaAction(nextStop(stops), 'in_progress')).toEqual({
      index: 0,
      action: 'arrive',
      button: '1-oraliq manzilga yetdim',
    });
    // not before the trip starts
    expect(viaAction(nextStop(stops), 'driver_arrived')).toBeNull();
  });

  it('drives on from a stop the car is at, then heads to the next', () => {
    const at0 = stopList([withStops('in_progress', [via(T, null), via(null, null)])]);
    expect(nextStop(at0)).toMatchObject({ kind: 'via', index: 0, arrived: true });
    expect(viaAction(nextStop(at0), 'in_progress')?.action).toBe('leave');
    const past0 = stopList([withStops('in_progress', [via(T, T), via(null, null)])]);
    expect(nextStop(past0)).toMatchObject({ kind: 'via', index: 1 });
  });

  it('skips a stop the car went past, and ends at the drop-off', () => {
    const skipped = stopList([withStops('in_progress', [via(null, null), via(T, T)])]);
    expect(nextStop(skipped)?.kind).toBe('dropoff');
    expect(viaAction(nextStop(skipped), 'in_progress')).toBeNull();
  });
});

describe('in Russian', () => {
  afterEach(() => setLanguage('uz'));

  it('words the intermediate stop buttons', () => {
    setLanguage('ru');
    const stop = {
      key: 'v:via1',
      kind: 'via' as const,
      index: 1,
      rideId: 'v',
      rideNumber: 1,
      place: { lat: 0, lng: 0, address: null, landmark: null },
      done: false,
      current: true,
    };
    expect(viaAction(stop, 'in_progress')?.button).toBe('Я на остановке 2');
    expect(viaAction({ ...stop, arrived: true }, 'in_progress')?.button).toBe('Продолжить');
  });
});
