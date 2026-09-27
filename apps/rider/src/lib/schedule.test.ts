import { describe, expect, it } from 'vitest';
import { schedulable, scheduleSlots, searchStartsAt } from './schedule';

describe('rides for later', () => {
  it('offers quarter-hour slots from 35 minutes to 24 hours ahead', () => {
    const now = new Date('2026-09-27T10:02:00Z');
    const slots = scheduleSlots(now);
    // 10:02 + 35 min = 10:37 -> the next quarter hour
    expect(slots[0]!.toISOString()).toBe('2026-09-27T10:45:00.000Z');
    expect(slots.at(-1)!.toISOString()).toBe('2026-09-28T10:00:00.000Z');
    expect(slots.every((d) => schedulable(d, now))).toBe(true);
    expect(slots).toHaveLength(94);
  });

  it('checks the API window', () => {
    const now = new Date('2026-09-27T10:00:00Z');
    expect(schedulable('2026-09-27T10:29:00Z', now)).toBe(false);
    expect(schedulable('2026-09-27T10:30:00Z', now)).toBe(true);
    expect(schedulable('2026-09-28T10:00:00Z', now)).toBe(true);
    expect(schedulable('2026-09-28T10:01:00Z', now)).toBe(false);
  });

  it('knows when the search starts', () => {
    expect(searchStartsAt('2026-09-27T10:00:00Z').toISOString()).toBe('2026-09-27T09:45:00.000Z');
  });
});
