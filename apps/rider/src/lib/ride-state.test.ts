import { describe, expect, it } from 'vitest';
import type { RideStatus } from '../api/types';
import { cancelledText, distanceM, etaMinutes, isOpenStatus, rideScreen } from './ride-state';

const screen = (status: RideStatus, extra: Partial<Parameters<typeof rideScreen>[0]> = {}) =>
  rideScreen({ status, cancelledBy: null, ...extra });

describe('ride state -> screen', () => {
  it('maps every status to its phase', () => {
    expect(screen('searching')).toMatchObject({
      phase: 'searching',
      final: false,
      showDriver: false,
      canCancel: true,
      canSos: false,
      canShare: false,
      heading: null,
    });
    expect(screen('driver_assigned')).toMatchObject({
      phase: 'assigned',
      showDriver: true,
      canCancel: true,
      canShare: true,
      canSos: true,
      heading: 'pickup',
    });
    expect(screen('driver_arrived')).toMatchObject({
      phase: 'arrived',
      canCancel: true,
      heading: null,
    });
    expect(screen('in_progress')).toMatchObject({
      phase: 'on_trip',
      canCancel: false,
      canSos: true,
      canShare: true,
      heading: 'dropoff',
    });
    expect(screen('completed')).toMatchObject({
      phase: 'completed',
      final: true,
      showDriver: false,
    });
  });

  it('tells a failed search from other cancellations', () => {
    expect(screen('cancelled', { cancelledBy: 'system' })).toMatchObject({
      phase: 'no_driver',
      title: 'Bo‘sh mashina topilmadi',
      final: true,
      canCancel: false,
    });
    expect(screen('cancelled', { cancelledBy: 'rider' }).phase).toBe('cancelled');
    expect(screen('cancelled', { cancelledBy: 'operator' }).phase).toBe('cancelled');
  });

  it('follows the API when it says the ride cannot be cancelled', () => {
    expect(screen('driver_arrived', { canCancel: false }).canCancel).toBe(false);
  });

  it('explains who cancelled', () => {
    expect(cancelledText({ cancelledBy: 'rider', cancelReason: null })).toMatch(/Siz/);
    expect(cancelledText({ cancelledBy: 'operator', cancelReason: 'Mijoz so‘radi' })).toBe(
      'Operator buyurtmani bekor qildi: Mijoz so‘radi.',
    );
    expect(cancelledText({ cancelledBy: 'system', cancelReason: 'Haydovchi topilmadi' })).toMatch(
      /operatorga/,
    );
  });

  it('knows open rides', () => {
    expect(isOpenStatus('searching')).toBe(true);
    expect(isOpenStatus('in_progress')).toBe(true);
    expect(isOpenStatus('completed')).toBe(false);
    expect(isOpenStatus('cancelled')).toBe(false);
  });
});

describe('eta', () => {
  const guliston = { lat: 40.49598, lng: 68.77587 };

  it('measures straight-line distance', () => {
    // ~1.11 km per 0.01° of latitude
    expect(distanceM(guliston, { lat: guliston.lat + 0.01, lng: guliston.lng })).toBeCloseTo(
      1112,
      -1,
    );
  });

  it('estimates minutes at city speed with the detour factor', () => {
    expect(etaMinutes(null, guliston)).toBeNull();
    expect(etaMinutes(guliston, guliston)).toBe(1);
    // 3.33 km straight -> 4.5 road km at 25 km/h -> ~11 min
    expect(etaMinutes({ lat: guliston.lat + 0.03, lng: guliston.lng }, guliston)).toBe(11);
  });
});
