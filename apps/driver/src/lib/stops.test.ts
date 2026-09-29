import { describe, expect, it } from 'vitest';
import { nextStop, stopList, type StopRide, stopsFromPool } from './stops';

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
