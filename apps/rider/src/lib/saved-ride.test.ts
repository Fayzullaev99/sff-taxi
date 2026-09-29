import { describe, expect, it } from 'vitest';
import { decodeSavedRide, encodeSavedRide, SAVED_RIDE_MAX_AGE_MS } from './saved-ride';

const NOW = Date.UTC(2026, 8, 29, 9, 0, 0);
const ride = (status: string) =>
  ({
    id: 'r1',
    status,
    number: 10001,
    trail: [{ lat: 1, lng: 2, at: 'x' }],
  }) as unknown as { id: string; status: 'driver_assigned'; trail: unknown[]; number: number };

describe('the open ride kept on the phone', () => {
  it('keeps an open ride without its trail and reads it back', () => {
    const raw = encodeSavedRide(ride('driver_assigned'), NOW);
    expect(raw).not.toBeNull();
    const back = decodeSavedRide<ReturnType<typeof ride>>(raw, NOW + 60_000);
    expect(back?.savedAt).toBe(NOW);
    expect(back?.ride).toMatchObject({ id: 'r1', status: 'driver_assigned', number: 10001 });
    expect(back?.ride.trail).toEqual([]);
  });

  it('keeps nothing for no ride, a finished one or a ride for later', () => {
    expect(encodeSavedRide(null, NOW)).toBeNull();
    for (const s of ['completed', 'cancelled', 'scheduled']) {
      expect(encodeSavedRide(ride(s), NOW)).toBeNull();
    }
  });

  it('drops what is too old, from the future, broken or finished', () => {
    const raw = encodeSavedRide(ride('in_progress'), NOW);
    expect(decodeSavedRide(raw, NOW + SAVED_RIDE_MAX_AGE_MS + 1)).toBeNull();
    expect(decodeSavedRide(raw, NOW - 5 * 60_000)).toBeNull();
    expect(decodeSavedRide('{', NOW)).toBeNull();
    expect(decodeSavedRide(null, NOW)).toBeNull();
    expect(decodeSavedRide('{"v":2,"savedAt":1,"ride":{}}', NOW)).toBeNull();
    const done = JSON.stringify({ v: 1, savedAt: NOW, ride: { id: 'r1', status: 'completed' } });
    expect(decodeSavedRide(done, NOW)).toBeNull();
  });
});
