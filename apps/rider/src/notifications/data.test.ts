import { describe, expect, it } from 'vitest';
import { pushLocale, resolveProjectId, rideIdFromData } from './data';

describe('push data', () => {
  const rideId = '0192f0a4-8b7e-7c3d-9a1b-2c3d4e5f6a7b';

  it('finds the ride a notification is about', () => {
    expect(rideIdFromData({ kind: 'driver_assigned', rideId })).toBe(rideId);
    expect(rideIdFromData({ kind: 'driver_arrived', rideId: 'nope' })).toBeNull();
    expect(rideIdFromData({ kind: 'x' })).toBeNull();
    expect(rideIdFromData(null)).toBeNull();
    expect(rideIdFromData('text')).toBeNull();
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
