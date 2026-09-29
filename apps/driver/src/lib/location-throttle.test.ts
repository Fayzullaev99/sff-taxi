import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client';
import { distanceM } from './geo';
import { locationPolicy } from './location-policy';
import {
  type Fix,
  fixVerdict,
  LocationReporter,
  MAX_FIX_AGE_MS,
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

const GULISTAN = { lat: 40.4897, lng: 68.7842 };
/** About `m` metres north of GULISTAN, taken at `at` (ms), accurate to `accuracy` m. */
function north(m: number, at: number, accuracy: number | null = 8): Fix {
  return { lat: GULISTAN.lat + m / 111_195, lng: GULISTAN.lng, at, accuracy };
}

const idle = locationPolicy('idle')!.send;
const trip = locationPolicy('on_trip')!.send;
const toPickup = locationPolicy('to_pickup')!.send;

describe('distanceM', () => {
  it('measures short and long distances', () => {
    expect(distanceM(GULISTAN, GULISTAN)).toBe(0);
    expect(distanceM(GULISTAN, north(100, 0))).toBeCloseTo(100, 0);
    // Gulistan -> Tashkent is roughly 100 km as the crow flies
    const km = distanceM(GULISTAN, { lat: 41.3111, lng: 69.2797 }) / 1000;
    expect(km).toBeGreaterThan(90);
    expect(km).toBeLessThan(110);
  });
});

describe('shouldSendLocation', () => {
  it('always sends the first fix', () => {
    expect(shouldSendLocation(null, north(0, 0), idle)).toBe(true);
  });

  it('idle: a parked car keeps its place fresh every 30 s only', () => {
    const last = north(0, 0);
    expect(shouldSendLocation(last, north(3, 15_000), idle)).toBe(false);
    expect(shouldSendLocation(last, north(3, 29_000), idle)).toBe(false);
    expect(shouldSendLocation(last, north(3, 30_000), idle)).toBe(true);
  });

  it('idle: a moving car every 15 s, a 50 m move after 10 s', () => {
    const last = north(0, 0);
    expect(shouldSendLocation(last, north(30, 10_000), idle)).toBe(false);
    expect(shouldSendLocation(last, north(30, 15_000), idle)).toBe(true);
    expect(shouldSendLocation(last, north(60, 9_000), idle)).toBe(false);
    expect(shouldSendLocation(last, north(60, 10_000), idle)).toBe(true);
  });

  it('on a trip: every ~3 s, tolerating a GPS delivery a little early', () => {
    const last = north(0, 0);
    expect(shouldSendLocation(last, north(0, 2_000), trip)).toBe(false);
    expect(shouldSendLocation(last, north(0, 2_700), trip)).toBe(true);
    expect(shouldSendLocation(last, north(0, 3_000), trip)).toBe(true);
  });

  it('to the pickup: every ~4 s', () => {
    const last = north(0, 0);
    expect(shouldSendLocation(last, north(10, 3_000), toPickup)).toBe(false);
    expect(shouldSendLocation(last, north(10, 4_000), toPickup)).toBe(true);
    expect(shouldSendLocation(last, north(40, 3_000), toPickup)).toBe(true);
  });

  it('never sends a fix the API would refuse as inaccurate', () => {
    expect(shouldSendLocation(null, north(0, 0, 150), idle)).toBe(false);
    expect(shouldSendLocation(null, north(0, 0, 100), idle)).toBe(true);
    expect(shouldSendLocation(null, north(0, 0, null), idle)).toBe(true);
  });

  it('never sends twice within the minimum gap, however far the jump', () => {
    const last = north(0, 0);
    expect(shouldSendLocation(last, north(500, 2_000), trip)).toBe(false);
  });
});

describe('fixVerdict', () => {
  const ctx = { lastSeenAt: null, lastGoodAt: null, now: 10_000 };

  it('passes a fresh, accurate fix', () => {
    expect(fixVerdict(north(0, 10_000), ctx)).toBe('ok');
  });

  it('drops fixes over 100 m and rough ones while good fixes are coming', () => {
    expect(fixVerdict(north(0, 10_000, 120), ctx)).toBe('inaccurate');
    expect(fixVerdict(north(0, 10_000, 70), { ...ctx, lastGoodAt: 5_000 })).toBe('rough');
    // no good fix for a while: a 70 m fix is still better than none
    expect(fixVerdict(north(0, 60_000, 70), { ...ctx, lastGoodAt: 5_000, now: 60_000 })).toBe('ok');
    expect(fixVerdict(north(0, 10_000, 70), ctx)).toBe('ok');
  });

  it('drops the same fix delivered twice and out-of-order ones', () => {
    expect(fixVerdict(north(0, 5_000), { ...ctx, lastSeenAt: 5_000 })).toBe('duplicate');
    expect(fixVerdict(north(0, 4_000), { ...ctx, lastSeenAt: 5_000 })).toBe('duplicate');
  });

  it('drops old fixes: the API would stamp them "now"', () => {
    expect(fixVerdict(north(0, 0), { ...ctx, now: MAX_FIX_AGE_MS + 1 })).toBe('stale');
  });

  it('drops nonsense coordinates', () => {
    expect(fixVerdict({ lat: 0, lng: 0, at: 10_000 }, ctx)).toBe('invalid');
    expect(fixVerdict({ lat: Number.NaN, lng: 1, at: 10_000 }, ctx)).toBe('invalid');
  });
});

/** A controllable clock and timer queue. */
function fakeTime(start = 0) {
  let now = start;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => now,
    set(ms: number) {
      now = ms;
    },
    schedule(fn: () => void, ms: number) {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    /** Moves the clock and runs the timers that came due. */
    async advance(to: number) {
      now = to;
      for (const t of timers.filter((x) => x.live && x.at <= now)) {
        t.live = false;
        t.fn();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
    get liveTimers() {
      return timers.filter((t) => t.live).length;
    },
  };
}

const offline = () => new ApiError(0, 'offline');
const isRetryable = (e: unknown) =>
  e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 429);

describe('LocationReporter', () => {
  it('sends throttled fixes by the current rules', async () => {
    const time = fakeTime(0);
    const send = vi.fn(async () => {});
    const reporter = new LocationReporter(send, trip, { now: time.now });

    expect(await reporter.report(north(0, 0))).toBe('sent');
    time.set(1_000);
    expect(await reporter.report(north(5, 1_000))).toBe('skipped');
    time.set(3_000);
    expect(await reporter.report(north(30, 3_000))).toBe('sent');

    // going idle: the same pace is now too fast
    reporter.setRules(idle);
    time.set(6_000);
    expect(await reporter.report(north(40, 6_000))).toBe('skipped');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual([{ lat: GULISTAN.lat, lng: GULISTAN.lng, accuracy: 8 }]);
  });

  it('never runs two sends at once; the newest fix follows if it is due', async () => {
    const time = fakeTime(0);
    let finish: () => void = () => {};
    const send = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const reporter = new LocationReporter(send, trip, { now: time.now });

    const first = reporter.report(north(0, 0));
    time.set(3_000);
    // arrives while the first is out: queued, not sent in parallel
    expect(await reporter.report(north(100, 3_000))).toBe('queued');
    expect(send).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    // the second one goes right after (it is 3 s newer than the one just sent)
    expect(send).toHaveBeenCalledTimes(2);
    finish();
    expect(await first).toBe('sent');
  });

  it('keeps the newest fix while offline and retries with backoff', async () => {
    const time = fakeTime(0);
    const send = vi.fn<(p: unknown) => Promise<void>>();
    const onError = vi.fn();
    const reporter = new LocationReporter(send, trip, {
      now: time.now,
      schedule: time.schedule,
      isRetryable,
      onError,
      random: () => 1,
    });

    send.mockRejectedValueOnce(offline());
    expect(await reporter.report(north(0, 0))).toBe('queued');
    expect(reporter.hasPending).toBe(true);
    expect(onError).toHaveBeenCalledOnce();

    // within the 1 s backoff a newer fix replaces the waiting one, nothing is sent
    time.set(500);
    expect(await reporter.report(north(10, 500))).toBe('queued');
    expect(send).toHaveBeenCalledOnce();

    // second failure: 2 s
    send.mockRejectedValueOnce(offline());
    await time.advance(1_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toMatchObject({ lat: north(10, 0).lat });
    expect(reporter.failureCount).toBe(2);

    send.mockResolvedValueOnce(undefined);
    await time.advance(2_999);
    expect(send).toHaveBeenCalledTimes(2);
    await time.advance(3_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(reporter.hasPending).toBe(false);
    expect(reporter.failureCount).toBe(0);
  });

  it('a new fix after the backoff retries without any timer', async () => {
    const time = fakeTime(0);
    const send = vi.fn<(p: unknown) => Promise<void>>();
    const reporter = new LocationReporter(send, trip, {
      now: time.now,
      isRetryable,
      random: () => 1,
    });
    send.mockRejectedValueOnce(offline());
    await reporter.report(north(0, 0));
    send.mockResolvedValueOnce(undefined);
    time.set(1_500);
    expect(await reporter.report(north(5, 1_500))).toBe('sent');
  });

  it('flush sends the waiting fix at once when the connection returns', async () => {
    const time = fakeTime(0);
    const send = vi.fn<(p: unknown) => Promise<void>>();
    const reporter = new LocationReporter(send, idle, {
      now: time.now,
      isRetryable,
      random: () => 1,
    });
    send.mockRejectedValue(offline());
    await reporter.report(north(0, 0));
    time.set(100);
    await reporter.report(north(1, 100));
    for (let i = 0; i < 4; i++) {
      time.set(time.now() + 20_000);
      await reporter.flush();
    }
    // the waiting fix got too old meanwhile: dropped rather than sent as "now"
    expect(reporter.hasPending).toBe(false);

    send.mockReset();
    send.mockResolvedValue(undefined);
    const t = time.now() + 100;
    time.set(t);
    await reporter.report(north(2, t));
    expect(send).toHaveBeenCalledOnce();
  });

  it('drops a refused fix (422) and does not back off', async () => {
    const time = fakeTime(0);
    const send = vi.fn<(p: unknown) => Promise<void>>();
    const onError = vi.fn();
    const reporter = new LocationReporter(send, trip, { now: time.now, isRetryable, onError });
    send.mockRejectedValueOnce(new ApiError(422, 'x', { reason: 'too_fast' }));
    expect(await reporter.report(north(0, 0))).toBe('queued');
    expect(reporter.hasPending).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    send.mockResolvedValueOnce(undefined);
    time.set(100);
    expect(await reporter.report(north(1, 100))).toBe('sent');
  });

  it('drops duplicates, rough and stale fixes before throttling', async () => {
    const time = fakeTime(10_000);
    const send = vi.fn(async () => {});
    const reporter = new LocationReporter(send, trip, { now: time.now });
    expect(await reporter.report(north(0, 10_000))).toBe('sent');
    expect(await reporter.report(north(0, 10_000))).toBe('duplicate');
    time.set(14_000);
    expect(await reporter.report(north(0, 14_000, 80))).toBe('rough');
    expect(await reporter.report(north(0, 14_000 - MAX_FIX_AGE_MS - 1))).toBe('duplicate');
    expect(send).toHaveBeenCalledOnce();
  });

  it('starts over after reset', async () => {
    const send = vi.fn(async () => {});
    const reporter = new LocationReporter(send, idle, { now: () => 1_000 });
    await reporter.report(north(0, 0));
    reporter.reset();
    expect(await reporter.report(north(0, 1_000))).toBe('sent');
  });

  it('markSent counts a fix sent elsewhere (going on shift)', async () => {
    const send = vi.fn(async () => {});
    const reporter = new LocationReporter(send, idle, { now: () => 2_000 });
    reporter.markSent(north(0, 0));
    expect(await reporter.report(north(1, 2_000))).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });
});
