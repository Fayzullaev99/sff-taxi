import { describe, expect, it, vi } from 'vitest';
import { distanceM } from './geo';
import {
  type Fix,
  LocationReporter,
  shouldSendLocation,
  toLocationPayload,
} from './location-throttle';

describe('toLocationPayload', () => {
  it('sends accuracy, heading and speed the phone measured', () => {
    expect(
      toLocationPayload({
        lat: 40.5,
        lng: 68.8,
        at: 0,
        accuracy: 7.84,
        heading: 359.7,
        speed: 4.26,
      }),
    ).toEqual({ lat: 40.5, lng: 68.8, accuracy: 7.8, heading: 0, speed: 4.3 });
  });

  it('drops unknown readings (iOS -1, null, NaN)', () => {
    expect(
      toLocationPayload({ lat: 1, lng: 2, at: 0, accuracy: null, heading: -1, speed: -1 }),
    ).toEqual({ lat: 1, lng: 2 });
    expect(toLocationPayload({ lat: 1, lng: 2, at: 0, accuracy: Number.NaN, speed: 5000 })).toEqual(
      { lat: 1, lng: 2 },
    );
  });
});

const TASHKENT = { lat: 41.3111, lng: 69.2797 };
/** About `m` metres north of TASHKENT. */
function north(m: number, at: number): Fix {
  return { lat: TASHKENT.lat + m / 111_195, lng: TASHKENT.lng, at };
}

describe('distanceM', () => {
  it('measures short and long distances', () => {
    expect(distanceM(TASHKENT, TASHKENT)).toBe(0);
    expect(distanceM(TASHKENT, north(100, 0))).toBeCloseTo(100, 0);
    // Tashkent -> Samarkand is roughly 270 km as the crow flies
    const km = distanceM(TASHKENT, { lat: 39.6542, lng: 66.9597 }) / 1000;
    expect(km).toBeGreaterThan(260);
    expect(km).toBeLessThan(280);
  });
});

describe('shouldSendLocation', () => {
  it('always sends the first fix', () => {
    expect(shouldSendLocation(null, north(0, 0))).toBe(true);
  });

  it('holds back small moves until 5 s have passed', () => {
    const last = north(0, 0);
    expect(shouldSendLocation(last, north(10, 3_500))).toBe(false);
    expect(shouldSendLocation(last, north(10, 4_999))).toBe(false);
    expect(shouldSendLocation(last, north(0, 5_000))).toBe(true);
  });

  it('sends early after moving more than 25 m', () => {
    const last = north(0, 0);
    expect(shouldSendLocation(last, north(24, 3_500))).toBe(false);
    expect(shouldSendLocation(last, north(30, 3_500))).toBe(true);
  });

  it('does not send fixes the API would refuse as inaccurate', () => {
    expect(shouldSendLocation(null, { ...north(0, 0), accuracy: 150 })).toBe(false);
    expect(shouldSendLocation(null, { ...north(0, 0), accuracy: 100 })).toBe(true);
    expect(shouldSendLocation(null, { ...north(0, 0), accuracy: null })).toBe(true);
  });

  it('never sends twice within 3 s, however far the jump', () => {
    const last = north(0, 0);
    expect(shouldSendLocation(last, north(500, 2_999))).toBe(false);
    expect(shouldSendLocation(last, north(500, 3_000))).toBe(true);
  });
});

describe('LocationReporter', () => {
  it('sends throttled fixes and retries after a failure', async () => {
    const send = vi.fn<(p: { lat: number; lng: number }) => Promise<void>>();
    const onError = vi.fn();
    const reporter = new LocationReporter(send, undefined, onError);

    send.mockResolvedValueOnce(undefined);
    expect(await reporter.report(north(0, 0))).toBe(true);
    expect(await reporter.report(north(5, 4_000))).toBe(false);

    send.mockRejectedValueOnce(new Error('offline'));
    expect(await reporter.report(north(5, 16_000))).toBe(false);
    expect(onError).toHaveBeenCalledOnce();

    // the failed fix was not remembered: the next one goes out at once
    send.mockResolvedValueOnce(undefined);
    expect(await reporter.report(north(5, 17_000))).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0]?.[0]).toEqual({ lat: TASHKENT.lat, lng: TASHKENT.lng });
  });

  it('keeps one request in flight', async () => {
    let finish: () => void = () => {};
    const send = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const reporter = new LocationReporter(send);
    const first = reporter.report(north(0, 0));
    expect(await reporter.report(north(500, 60_000))).toBe(false);
    finish();
    expect(await first).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });

  it('starts over after reset', async () => {
    const send = vi.fn(async () => {});
    const reporter = new LocationReporter(send);
    await reporter.report(north(0, 0));
    reporter.reset();
    expect(await reporter.report(north(0, 1_000))).toBe(true);
  });
});
