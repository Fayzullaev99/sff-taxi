import { describe, expect, it } from 'vitest';
import { litSegments, offerCountdown, ServerClock } from './countdown';

const T0 = Date.parse('2026-09-26T10:00:00Z');
const in15 = new Date(T0 + 15_000).toISOString();

describe('offerCountdown', () => {
  it('counts a direct offer down from 15 s', () => {
    expect(offerCountdown({ expiresAt: in15, kind: 'direct', serverNow: T0 })).toEqual({
      seconds: 15,
      fraction: 1,
      expired: false,
      urgent: false,
    });
    const later = offerCountdown({ expiresAt: in15, kind: 'direct', serverNow: T0 + 10_200 });
    expect(later.seconds).toBe(5);
    expect(later.urgent).toBe(true);
    expect(later.fraction).toBeCloseTo(0.32, 2);
  });

  it('is over at the deadline and after it', () => {
    expect(
      offerCountdown({ expiresAt: in15, kind: 'direct', serverNow: T0 + 15_000 }),
    ).toMatchObject({ seconds: 0, fraction: 0, expired: true });
    expect(
      offerCountdown({ expiresAt: in15, kind: 'direct', serverNow: T0 + 60_000 }).expired,
    ).toBe(true);
  });

  it('never shows more than the offer can last (phone clock behind)', () => {
    const c = offerCountdown({ expiresAt: in15, kind: 'direct', serverNow: T0 - 120_000 });
    expect(c.seconds).toBe(15);
    expect(c.fraction).toBe(1);
  });

  it('gives broadcast offers 30 s', () => {
    const in30 = new Date(T0 + 30_000).toISOString();
    expect(offerCountdown({ expiresAt: in30, kind: 'broadcast', serverNow: T0 })).toMatchObject({
      seconds: 30,
      fraction: 1,
    });
    expect(
      offerCountdown({ expiresAt: in30, kind: 'broadcast', serverNow: T0 + 15_000 }).fraction,
    ).toBe(0.5);
  });

  it('treats a broken expiry as expired', () => {
    expect(offerCountdown({ expiresAt: 'x', kind: 'direct', serverNow: T0 }).expired).toBe(true);
  });
});

describe('ServerClock', () => {
  it('is the phone clock until the server answered', () => {
    expect(new ServerClock().now(T0)).toBe(T0);
  });

  it('corrects a phone that is two minutes fast', () => {
    const clock = new ServerClock();
    // the server says 10:00:00 (truncated), the answer arrived at the phone's 10:02:00.3
    clock.observe(T0, T0 + 120_300);
    clock.observe(T0 + 5_000, T0 + 125_900); // slower answer: a smaller sample
    const serverNow = clock.now(T0 + 130_000);
    expect(Math.abs(serverNow - (T0 + 10_000))).toBeLessThanOrEqual(1_000);
    // the offer created at server 10:00:05 still has ~10 s left on this phone
    const c = offerCountdown({
      expiresAt: new Date(T0 + 20_000).toISOString(),
      kind: 'direct',
      serverNow,
    });
    expect(c.seconds).toBeGreaterThanOrEqual(9);
    expect(c.seconds).toBeLessThanOrEqual(11);
  });

  it('keeps only recent samples', () => {
    const clock = new ServerClock(2);
    clock.observe(T0 + 60_000, T0); // old, wrong
    clock.observe(T0, T0);
    clock.observe(T0, T0);
    expect(clock.offsetMs).toBe(500);
  });
});

describe('litSegments', () => {
  it('lights the ring in proportion, none when over', () => {
    expect(litSegments(1, 30)).toBe(30);
    expect(litSegments(0.5, 30)).toBe(15);
    expect(litSegments(0.01, 30)).toBe(1);
    expect(litSegments(0, 30)).toBe(0);
    expect(litSegments(Number.NaN, 30)).toBe(0);
  });
});
