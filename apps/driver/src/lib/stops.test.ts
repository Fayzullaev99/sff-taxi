import { describe, expect, it } from 'vitest';
import { nextStop, stopList, type StopRide } from './stops';

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
