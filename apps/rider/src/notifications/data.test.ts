import { describe, expect, it } from 'vitest';
import {
  bookingIdFromData,
  complaintIdFromData,
  pushLocale,
  pushPermissionState,
  pushTarget,
  resolveProjectId,
  rideIdFromData,
} from './data';

describe('push data', () => {
  const rideId = '0192f0a4-8b7e-7c3d-9a1b-2c3d4e5f6a7b';

  it('finds the ride a notification is about', () => {
    expect(rideIdFromData({ kind: 'driver_assigned', rideId })).toBe(rideId);
    expect(rideIdFromData({ kind: 'driver_arrived', rideId: 'nope' })).toBeNull();
    expect(rideIdFromData({ kind: 'x' })).toBeNull();
    expect(rideIdFromData(null)).toBeNull();
    expect(rideIdFromData('text')).toBeNull();
  });

  it('finds the intercity booking a notification is about', () => {
    expect(bookingIdFromData({ kind: 'intercity_booked', tripId: rideId, bookingId: rideId })).toBe(
      rideId,
    );
    expect(bookingIdFromData({ kind: 'x', bookingId: 'nope' })).toBeNull();
    expect(bookingIdFromData({ kind: 'driver_assigned', rideId })).toBeNull();
  });

  it('picks the push language', () => {
    expect(pushLocale('ru-RU')).toBe('ru');
    expect(pushLocale('uz-Latn-UZ')).toBe('uz');
    expect(pushLocale(undefined)).toBe('uz');
  });

  it('finds the EAS project id or none', () => {
    expect(resolveProjectId({ eas: { projectId: ' abc ' } }, undefined, undefined)).toBe('abc');
    expect(resolveProjectId(undefined, 'def', undefined)).toBe('def');
    expect(resolveProjectId(null, null, '')).toBeNull();
  });
});

describe('where a tapped push leads', () => {
  const rideId = '0192f0a4-8b7e-7c3d-9a1b-2c3d4e5f6a7b';
  const complaintId = '0192f0a4-8b7e-7c3d-9a1b-2c3d4e5f6a7c';

  it('opens the ticket for an operator answer or decision', () => {
    expect(complaintIdFromData({ kind: 'complaint_answered', rideId, complaintId })).toBe(
      complaintId,
    );
    expect(pushTarget({ kind: 'complaint_answered', rideId, complaintId })).toEqual({
      screen: 'complaint',
      id: complaintId,
    });
    expect(pushTarget({ kind: 'complaint_resolved', rideId, complaintId })).toEqual({
      screen: 'complaint',
      id: complaintId,
    });
  });

  it('opens the ride for a refund and other ride pushes', () => {
    expect(pushTarget({ kind: 'refund_pending', rideId })).toEqual({ screen: 'ride', id: rideId });
    expect(pushTarget({ kind: 'refunded', rideId })).toEqual({ screen: 'ride', id: rideId });
    expect(pushTarget({ kind: 'driver_assigned', rideId, complaintId: 'bad' })).toEqual({
      screen: 'ride',
      id: rideId,
    });
  });

  it('opens a booking, or nothing', () => {
    expect(pushTarget({ kind: 'intercity_booked', tripId: rideId, bookingId: rideId })).toEqual({
      screen: 'booking',
      id: rideId,
    });
    expect(pushTarget({ kind: 'x' })).toBeNull();
    expect(pushTarget(null)).toBeNull();
  });
});

describe('pushPermissionState', () => {
  it('asks when Android reports "denied" for a permission never asked', () => {
    expect(pushPermissionState({ granted: false, status: 'denied', canAskAgain: true })).toBe(
      'undetermined',
    );
    expect(pushPermissionState({ granted: false, status: 'undetermined', canAskAgain: true })).toBe(
      'undetermined',
    );
  });

  it('sends to the settings once the system will not ask again', () => {
    expect(pushPermissionState({ granted: false, status: 'denied', canAskAgain: false })).toBe(
      'denied',
    );
  });

  it('treats granted and iOS provisional as on', () => {
    expect(pushPermissionState({ granted: true, status: 'granted', canAskAgain: true })).toBe(
      'granted',
    );
    expect(
      pushPermissionState({
        granted: false,
        status: 'undetermined',
        canAskAgain: true,
        provisional: true,
      }),
    ).toBe('granted');
  });
});
