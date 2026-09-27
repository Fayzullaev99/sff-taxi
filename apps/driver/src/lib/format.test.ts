import { describe, expect, it } from 'vitest';
import { dateTime, time } from './format';

describe('time and dateTime', () => {
  it('show Tashkent time whatever the phone zone is', () => {
    // 13:09 UTC = 18:09 Tashkent (UTC+5, no DST)
    expect(time('2026-09-27T13:09:00Z')).toBe('18:09');
    expect(dateTime('2026-09-27T13:09:00Z')).toBe('27.09 18:09');
  });

  it('roll over to the next Tashkent day', () => {
    expect(dateTime('2026-12-31T20:30:00Z')).toBe('01.01 01:30');
  });

  it('are empty for a missing or bad time', () => {
    expect(time(null)).toBe('');
    expect(dateTime(null)).toBe('');
    expect(dateTime('not a date')).toBe('');
  });
});

describe('passLabel', () => {
  it('says when a pass ends in Tashkent time', async () => {
    const { passLabel } = await import('./money');
    expect(passLabel({ kind: 'day', endsAt: '2026-09-26T18:59:00Z' })).toBe(
      'Kunlik abonement · 26.09 23:59 gacha',
    );
  });
});
