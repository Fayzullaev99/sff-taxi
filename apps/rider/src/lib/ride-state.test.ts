import { describe, expect, it } from 'vitest';
import type { RideStatus } from '../api/types';
import {
  availabilityText,
  cancelledText,
  distanceM,
  etaMinutes,
  isOpenStatus,
  newerEta,
  pickupEta,
  rideScreen,
} from './ride-state';

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

  it('knows rides for later and card rides waiting for their payment', () => {
    expect(screen('scheduled')).toMatchObject({
      phase: 'scheduled',
      final: false,
      canCancel: true,
      showDriver: false,
    });
    expect(screen('awaiting_payment')).toMatchObject({
      phase: 'awaiting_payment',
      title: 'To‘lov kutilmoqda',
      final: false,
      canCancel: true,
    });
    expect(screen('cancelled', { cancelledBy: 'system', paymentStatus: 'failed' })).toMatchObject({
      phase: 'payment_failed',
      final: true,
    });
    expect(
      cancelledText({
        cancelledBy: 'system',
        cancelReason: 'x',
        status: 'cancelled',
        paymentStatus: 'failed',
      }),
    ).toMatch(/To‘lov 10 daqiqa/);
  });

  it('tells a scheduled ride dropped before its search from a search in vain', () => {
    const scheduledFor = '2026-09-27T08:00:00Z';
    // cancelled at activation (15 min before): the rider was on another ride
    const busy = {
      cancelledBy: 'system' as const,
      scheduledFor,
      cancelledAt: '2026-09-27T07:45:01Z',
    };
    expect(screen('cancelled', busy).phase).toBe('cancelled');
    expect(
      cancelledText({
        ...busy,
        status: 'cancelled',
        cancelReason: 'Boshqa safaringiz davom etmoqda',
      }),
    ).toBe('Buyurtma bekor qilindi: Boshqa safaringiz davom etmoqda.');
    // searched from 07:45, nobody found by 07:55
    expect(screen('cancelled', { ...busy, cancelledAt: '2026-09-27T07:55:00Z' }).phase).toBe(
      'no_driver',
    );
  });

  it('follows the API when it says the ride cannot be cancelled', () => {
    expect(screen('driver_arrived', { canCancel: false }).canCancel).toBe(false);
  });

  it('explains who cancelled', () => {
    const c = (cancelledBy: 'rider' | 'operator' | 'system', cancelReason: string | null) =>
      cancelledText({ status: 'cancelled', cancelledBy, cancelReason });
    expect(c('rider', null)).toMatch(/Siz/);
    expect(c('operator', 'Mijoz so‘radi')).toBe('Operator buyurtmani bekor qildi: Mijoz so‘radi.');
    expect(c('system', 'Haydovchi topilmadi')).toMatch(/operatorga/);
  });

  it('knows open rides', () => {
    expect(isOpenStatus('searching')).toBe(true);
    expect(isOpenStatus('in_progress')).toBe(true);
    expect(isOpenStatus('completed')).toBe(false);
    expect(isOpenStatus('cancelled')).toBe(false);
    expect(isOpenStatus('awaiting_payment')).toBe(true);
    // a ride for later does not take over the map
    expect(isOpenStatus('scheduled')).toBe(false);
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

  it('uses the API road ETA, counted down since it was computed', () => {
    const now = new Date('2026-09-27T10:00:30Z');
    const car = { lat: guliston.lat + 0.03, lng: guliston.lng };
    // 5 min at 10:00:00, 30 s ago -> 4.5 min left -> "5 min"
    expect(pickupEta({ etaS: 300, at: '2026-09-27T10:00:00Z' }, car, guliston, now)).toEqual({
      minutes: 5,
      source: 'api',
    });
    // almost there: never "0 min"
    expect(pickupEta({ etaS: 20, at: '2026-09-27T10:00:00Z' }, car, guliston, now)?.minutes).toBe(
      1,
    );
    // an old reading (stream down) gives way to the estimate from the car's position
    expect(pickupEta({ etaS: 300, at: '2026-09-27T09:55:00Z' }, car, guliston, now)).toEqual({
      minutes: 11,
      source: 'estimate',
    });
    expect(pickupEta(null, car, guliston, now)?.source).toBe('estimate');
    expect(pickupEta(null, null, guliston, now)).toBeNull();
  });

  it('takes the newer of the fetched and the streamed ETA', () => {
    const a = { etaS: 300, at: '2026-09-27T10:00:00Z' };
    const b = { etaS: 240, at: '2026-09-27T10:00:15Z' };
    expect(newerEta(a, b)).toBe(b);
    expect(newerEta(b, a)).toBe(b);
    expect(newerEta(null, a)).toBe(a);
    expect(newerEta(null, null)).toBeNull();
  });

  it('says how far the nearest free car is', () => {
    expect(availabilityText(null)).toBeNull();
    expect(availabilityText({ etaS: null, cars: 0 })).toBe('Yaqinda bo‘sh mashina yo‘q');
    expect(availabilityText({ etaS: 200, cars: 3 })?.replace(/\u00a0/g, ' ')).toBe(
      'Eng yaqin mashina ~4 daq',
    );
  });
});
