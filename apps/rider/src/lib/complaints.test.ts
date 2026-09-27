import { describe, expect, it } from 'vitest';
import { canComplain, COMPLAINT_TYPE_LABELS, COMPLAINT_TYPES } from './complaints';

describe('complaints', () => {
  it('offers every type the API takes, lost items first', () => {
    expect(COMPLAINT_TYPES[0]).toBe('lost_item');
    expect([...COMPLAINT_TYPES].sort()).toEqual(Object.keys(COMPLAINT_TYPE_LABELS).sort());
  });

  it('accepts complaints until 7 days after the ride ended', () => {
    const now = new Date('2026-09-27T10:00:00Z');
    expect(canComplain({ completedAt: null, cancelledAt: null }, now)).toBe(true);
    expect(canComplain({ completedAt: '2026-09-21T10:00:00Z', cancelledAt: null }, now)).toBe(true);
    expect(canComplain({ completedAt: null, cancelledAt: '2026-09-20T09:00:00Z' }, now)).toBe(
      false,
    );
  });
});
