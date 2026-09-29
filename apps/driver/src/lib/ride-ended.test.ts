import { describe, expect, it } from 'vitest';
import { carRides, endingOf, goneRides, rideEndedAlert } from './ride-ended';

const stop = (rideId: string, number: number, status: string) => ({
  rideId,
  number,
  type: 'pickup' as const,
  lat: 0,
  lng: 0,
  status,
});

describe('rides leaving the car', () => {
  const a = { id: 'A', number: 10020, status: 'driver_arrived' };
  const shared = {
    ...a,
    pool: { stops: [stop('A', 10020, 'driver_arrived'), stop('b', 10021, 'in_progress')] },
  };

  it('lists the current ride and every ride on a shared car’s stops, once', () => {
    expect(carRides(shared)).toEqual([
      { id: 'a', number: 10020, status: 'driver_arrived' },
      { id: 'b', number: 10021, status: 'in_progress' },
    ]);
    expect(carRides(null)).toEqual([]);
  });

  it('notices a ride gone from the car, however the new current ride came', () => {
    // the rider cancelled while the start-code keypad was open: the poll cleared the ride
    expect(goneRides(carRides(a), carRides(null)).map((r) => r.number)).toEqual([10020]);
    // the other rider of a shared car cancelled; the current ride follows the next stop
    const onlyA = { ...a, pool: { stops: [stop('a', 10020, 'driver_arrived')] } };
    expect(goneRides(carRides(shared), carRides(onlyA)).map((r) => r.id)).toEqual(['b']);
    // the next stop's ride became the current one: nobody left
    const b = { id: 'b', number: 10021, status: 'in_progress', pool: shared.pool };
    expect(goneRides(carRides(shared), carRides(b))).toEqual([]);
  });

  it('tells cancelled from taken away, and says nothing for a finished ride', () => {
    expect(endingOf({ status: 'cancelled' })).toBe('cancelled');
    expect(endingOf('missing')).toBe('taken');
    expect(endingOf({ status: 'completed' })).toBeNull();
    expect(endingOf({ status: 'in_progress' })).toBeNull();
  });

  it('words the alert as before', () => {
    const r = { id: 'a', number: 10020, status: 'driver_arrived' };
    expect(rideEndedAlert(r, 'cancelled').title).toBe('Buyurtma #10020 bekor qilindi');
    expect(rideEndedAlert(r, 'cancelled').text).toMatch(/bekor qilish haqi sizga yoziladi/);
    expect(rideEndedAlert({ ...r, status: 'driver_assigned' }, 'cancelled').text).toMatch(
      /Liniyada qolasiz/,
    );
    expect(rideEndedAlert(r, 'taken')).toEqual({
      title: 'Buyurtma #10020 sizdan olindi',
      text: 'Operator buyurtmani boshqa haydovchiga berdi. Unga bormang.',
    });
  });
});
