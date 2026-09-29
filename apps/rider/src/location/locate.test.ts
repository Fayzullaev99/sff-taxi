import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { betterFix, type Fix, isGoodFix, PRECISE, ROUGH } from './fix';
import { locate, type LocationDriver, locationProblemText } from './locate';

const NOW = 1_000_000_000;
const fix = (accuracyM: number | null, ageMs: number, lat = 40.5): Fix => ({
  lat,
  lng: 68.78,
  accuracyM,
  at: NOW - ageMs,
});

describe('fix rules', () => {
  it('a precise fix is fresh (≤30 s) and within 50 m', () => {
    expect(isGoodFix(fix(12, 5_000), NOW, PRECISE)).toBe(true);
    expect(isGoodFix(fix(50, 30_000), NOW, PRECISE)).toBe(true);
    expect(isGoodFix(fix(12, 31_000), NOW, PRECISE)).toBe(false);
    expect(isGoodFix(fix(80, 1_000), NOW, PRECISE)).toBe(false);
    expect(isGoodFix(fix(null, 1_000), NOW, PRECISE)).toBe(false);
    expect(isGoodFix(null, NOW, PRECISE)).toBe(false);
  });

  it('a rough fix may be two minutes old and a few hundred metres off', () => {
    expect(isGoodFix(fix(300, 90_000), NOW, ROUGH)).toBe(true);
    expect(isGoodFix(fix(300, 3 * 60_000), NOW, ROUGH)).toBe(false);
  });

  it('prefers a good fix, then the more precise, then a much newer one', () => {
    const good = fix(20, 2_000);
    const vague = fix(400, 1_000);
    expect(betterFix(vague, good, NOW, PRECISE)).toBe(good);
    expect(betterFix(good, vague, NOW, PRECISE)).toBe(good);
    const a = fix(120, 5_000);
    const b = fix(90, 8_000);
    expect(betterFix(a, b, NOW, PRECISE)).toBe(b);
    const old = fix(20, 10 * 60_000);
    const recent = fix(200, 1_000);
    // both fail the rules; the old one describes where the phone was minutes ago
    expect(betterFix(old, recent, NOW, PRECISE)).toBe(recent);
    expect(betterFix(null, a, NOW, PRECISE)).toBe(a);
    expect(betterFix(a, null, NOW, PRECISE)).toBe(a);
  });
});

/** A fake phone: fixes are pushed by the test through `emit`. */
function fakeDriver(over: Partial<LocationDriver> = {}) {
  let listener: ((f: Fix) => void) | null = null;
  const stops = { started: 0, stopped: 0, high: [] as boolean[] };
  const driver: LocationDriver = {
    permission: async () => ({ granted: true, canAskAgain: true }),
    servicesEnabled: async () => true,
    lastKnown: async () => null,
    watch: async (high, onFix) => {
      stops.started++;
      stops.high.push(high);
      listener = onFix;
      return () => {
        stops.stopped++;
        listener = null;
      };
    },
    ...over,
  };
  return { driver, stops, emit: (f: Fix) => listener?.(f) };
}

const opts = { rules: PRECISE, highAccuracy: true, timeoutMs: 10_000, ask: true, now: () => NOW };

describe('locating the phone', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says whether the permission can be asked again or needs the settings', async () => {
    const denied = fakeDriver({ permission: async () => ({ granted: false, canAskAgain: true }) });
    expect(await locate(denied.driver, opts)).toEqual({ ok: false, problem: 'denied' });
    const blocked = fakeDriver({
      permission: async () => ({ granted: false, canAskAgain: false }),
    });
    expect(await locate(blocked.driver, opts)).toEqual({ ok: false, problem: 'blocked' });
  });

  it('says when location services are off', async () => {
    const off = fakeDriver({ servicesEnabled: async () => false });
    expect(await locate(off.driver, opts)).toEqual({ ok: false, problem: 'services_off' });
    expect(off.stops.started).toBe(0);
  });

  it('takes a cached fix at once when it is fresh and precise (no GPS started)', async () => {
    const cached = fix(15, 4_000);
    const f = fakeDriver({ lastKnown: async () => cached });
    expect(await locate(f.driver, opts)).toEqual({ ok: true, fix: cached, precise: true });
    expect(f.stops.started).toBe(0);
  });

  it('ignores a stale cached fix and waits for a fresh precise one, then stops the GPS', async () => {
    const f = fakeDriver({ lastKnown: async () => fix(10, 5 * 60_000, 40.1) });
    const result = locate(f.driver, opts);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.stops.high).toEqual([true]);
    f.emit(fix(150, 0, 40.2)); // network fix: not good enough yet
    f.emit(fix(18, 0, 40.3));
    const r = await result;
    expect(r).toEqual({ ok: true, fix: fix(18, 0, 40.3), precise: true });
    expect(f.stops.stopped).toBe(1);
  });

  it('on timeout settles for the best fix seen, the cached one included', async () => {
    const f = fakeDriver({ lastKnown: async () => fix(30, 10 * 60_000, 40.1) });
    const result = locate(f.driver, opts);
    await vi.advanceTimersByTimeAsync(0);
    f.emit(fix(120, 0, 40.2));
    f.emit(fix(90, 0, 40.3));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({ ok: true, fix: fix(90, 0, 40.3), precise: false });
    expect(f.stops.stopped).toBe(1);
  });

  it('falls back to the last known position when no fix comes', async () => {
    const old = fix(25, 10 * 60_000);
    const f = fakeDriver({ lastKnown: async () => old });
    const result = locate(f.driver, opts);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({ ok: true, fix: old, precise: false });
  });

  it('is unavailable with no fix at all', async () => {
    const f = fakeDriver();
    const result = locate(f.driver, opts);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({ ok: false, problem: 'unavailable' });
    expect(f.stops.stopped).toBe(1);
  });

  it('stops at once when aborted (the app went to the background)', async () => {
    const f = fakeDriver();
    const controller = new AbortController();
    const result = locate(f.driver, { ...opts, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    f.emit(fix(200, 0));
    controller.abort();
    expect(await result).toEqual({ ok: true, fix: fix(200, 0), precise: false });
    expect(f.stops.stopped).toBe(1);
  });

  it('stops a watch that only started after the lookup ended', async () => {
    let startWatch: (() => void) | null = null;
    let stopped = 0;
    const f = fakeDriver({
      watch: () =>
        new Promise((resolve) => {
          startWatch = () =>
            resolve(() => {
              stopped++;
            });
        }),
    });
    const result = locate(f.driver, opts);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({ ok: false, problem: 'unavailable' });
    startWatch!();
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(1);
  });

  it('uses the balanced provider when asked', async () => {
    const f = fakeDriver();
    void locate(f.driver, { ...opts, highAccuracy: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.stops.high).toEqual([false]);
  });
});

describe('location problems in Uzbek', () => {
  it('gives each problem its own advice and action', () => {
    expect(locationProblemText('denied', true).action?.kind).toBe('ask');
    expect(locationProblemText('blocked', true).action?.kind).toBe('settings');
    expect(locationProblemText('services_off', true).action?.kind).toBe('services');
    expect(locationProblemText('unavailable', true).action).toBeNull();
  });

  it('points to the map or, without one, to the search', () => {
    expect(locationProblemText('denied', true).message).toContain('xaritada');
    expect(locationProblemText('denied', false).message).toContain('qidiruv');
  });
});
