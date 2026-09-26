import { describe, expect, it } from 'vitest';
import { clock, digits, distance, etaMinutes, formatPhone, som, uzPhoneDigits } from './format';
import { offersPollMs, offerToShow, pollInterval, POLL, pushTarget } from './refresh';

const NOW = Date.parse('2026-09-26T10:00:00Z');
const iso = (s: number) => new Date(NOW + s * 1000).toISOString();

describe('polling', () => {
  it('backs off while the stream is open', () => {
    expect(pollInterval(true, 10_000)).toBe(POLL.withStream);
    expect(pollInterval(false, 10_000)).toBe(10_000);
  });

  it('polls offers fast only while online, free and without a stream', () => {
    expect(offersPollMs(false, false, false)).toBe(false);
    expect(offersPollMs(true, true, false)).toBe(false);
    expect(offersPollMs(true, false, false)).toBe(4_000);
    expect(offersPollMs(true, false, true)).toBe(20_000);
  });
});

describe('offerToShow', () => {
  it('shows the freshest offer not yet handled and not expired', () => {
    const offers = [
      { id: 'a', expiresAt: iso(5) },
      { id: 'b', expiresAt: iso(25) },
      { id: 'c', expiresAt: iso(-1) },
    ];
    expect(offerToShow(offers, new Set(), NOW)?.id).toBe('b');
    expect(offerToShow(offers, new Set(['b']), NOW)?.id).toBe('a');
    expect(offerToShow(offers, new Set(['a', 'b']), NOW)).toBeNull();
    expect(offerToShow(undefined, new Set(), NOW)).toBeNull();
  });
});

describe('pushTarget', () => {
  const id = '0192f0a4-1b2c-7d3e-8f40-123456789abc';

  it('routes offers, rides and account changes', () => {
    expect(pushTarget({ kind: 'offer', offerId: id.toUpperCase(), rideId: id })).toEqual({
      kind: 'offer',
      offerId: id,
    });
    expect(pushTarget({ kind: 'rider_cancelled', rideId: id })).toEqual({
      kind: 'ride',
      rideId: id,
    });
    expect(pushTarget({ kind: 'driver_active' })).toEqual({ kind: 'home' });
  });

  it('ignores anything malformed', () => {
    expect(pushTarget({ kind: 'offer', offerId: 'nope' })).toBeNull();
    expect(pushTarget({ kind: 'x' })).toBeNull();
    expect(pushTarget(null)).toBeNull();
    expect(pushTarget('offer')).toBeNull();
  });
});

describe('format', () => {
  it('writes money, distances and times the Uzbek way', () => {
    expect(som(45_000)).toBe('45 000 so‘m');
    expect(som(-2_500)).toBe('−2 500 so‘m');
    expect(digits(1_234_567)).toBe('1 234 567');
    expect(distance(850)).toBe('850 m');
    expect(distance(3420)).toBe('3,4 km');
    expect(etaMinutes(20)).toBe('~1 daqiqa');
    expect(etaMinutes(250)).toBe('~4 daqiqa');
    expect(clock(125)).toBe('2:05');
    expect(clock(3725)).toBe('1:02:05');
    expect(clock(-3)).toBe('0:00');
  });

  it('reads and prints phone numbers', () => {
    expect(uzPhoneDigits('90 123-45-67')).toBe('901234567');
    expect(uzPhoneDigits('+998 90 123 45 67')).toBe('901234567');
    expect(uzPhoneDigits('12345')).toBeNull();
    expect(formatPhone('+998901234567')).toBe('+998 90 123 45 67');
  });
});
