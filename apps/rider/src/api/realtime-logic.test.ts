import { describe, expect, it } from 'vitest';
import {
  appendTrack,
  backoffMs,
  carPosition,
  MAX_BACKOFF_MS,
  parseRealtimeEvent,
  TRAIL_LENGTH,
  type TrackPoint,
} from './realtime-logic';

describe('reading stream events', () => {
  it('reads the events the rider gets', () => {
    expect(parseRealtimeEvent('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseRealtimeEvent('{"type":"ping"}')).toEqual({ type: 'ping' });
    expect(
      parseRealtimeEvent('{"type":"ride.updated","rideId":"r1","status":"driver_arrived"}'),
    ).toEqual({ type: 'ride.updated', rideId: 'r1', status: 'driver_arrived' });
    expect(
      parseRealtimeEvent(
        JSON.stringify({
          type: 'driver.location',
          rideId: 'r1',
          lat: 40.5,
          lng: 68.78,
          heading: 90,
          at: '2026-09-26T10:00:00Z',
        }),
      ),
    ).toEqual({
      type: 'driver.location',
      rideId: 'r1',
      lat: 40.5,
      lng: 68.78,
      heading: 90,
      at: '2026-09-26T10:00:00Z',
    });
  });

  it('ignores malformed and unknown events', () => {
    expect(parseRealtimeEvent('not json')).toBeNull();
    expect(parseRealtimeEvent('null')).toBeNull();
    expect(parseRealtimeEvent('{"type":"offer.new","offerId":"o1"}')).toBeNull();
    expect(parseRealtimeEvent('{"type":"ride.updated","rideId":"r1"}')).toBeNull();
    expect(
      parseRealtimeEvent('{"type":"driver.location","rideId":"r1","lat":"40","lng":68}'),
    ).toBeNull();
    expect(
      parseRealtimeEvent('{"type":"driver.location","rideId":"r1","lat":400,"lng":68}'),
    ).toBeNull();
  });

  it('defaults a missing heading', () => {
    const e = parseRealtimeEvent(
      '{"type":"driver.location","rideId":"r1","lat":40,"lng":68,"at":"x"}',
    );
    expect(e).toMatchObject({ heading: null, at: 'x' });
  });
});

describe('reconnecting', () => {
  it('backs off exponentially up to the cap', () => {
    expect(backoffMs(0, 0)).toBe(1000);
    expect(backoffMs(1, 0)).toBe(2000);
    expect(backoffMs(3, 0)).toBe(8000);
    expect(backoffMs(10, 0)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs(0, 1)).toBe(1500);
  });
});

describe('the car track', () => {
  const fix = (i: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({
    lat: 40 + i / 1000,
    lng: 68,
    heading: null,
    at: new Date(Date.UTC(2026, 8, 26, 10, 0, i)).toISOString(),
    ...extra,
  });

  it('appends in order and keeps the newest points', () => {
    let track: TrackPoint[] = [];
    for (let i = 0; i < TRAIL_LENGTH + 5; i++) track = appendTrack(track, fix(i));
    expect(track).toHaveLength(TRAIL_LENGTH);
    expect(track.at(-1)).toEqual(fix(TRAIL_LENGTH + 4));
  });

  it('drops late fixes and merges repeats', () => {
    const track = appendTrack([fix(1), fix(5)], fix(3));
    expect(track).toHaveLength(2);
    const repeat = appendTrack(track, { ...fix(5), at: fix(6).at, heading: 45 });
    expect(repeat).toHaveLength(2);
    expect(repeat.at(-1)).toMatchObject({ heading: 45, at: fix(6).at });
  });

  it('prefers the newer of the live fix and the fetched position', () => {
    const fetched = { lat: 1, lng: 2, heading: null, at: fix(10).at };
    expect(carPosition([], null)).toBeNull();
    expect(carPosition([], fetched)).toMatchObject({ lat: 1 });
    expect(carPosition([fix(5)], fetched)).toMatchObject({ lat: 1 });
    expect(carPosition([fix(12)], fetched)).toEqual(fix(12));
    expect(carPosition([fix(12)], null)).toEqual(fix(12));
  });
});
