import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/dictionary';
import {
  canComplain,
  complaintHint,
  complaintStatusLabel,
  complaintTypeLabel,
  COMPLAINT_TYPES,
  resolutionLabel,
} from './complaints';

afterEach(() => setLanguage('uz'));

describe('complaints', () => {
  it('offers every type the API takes, lost items first, each with a label and a hint', () => {
    expect(COMPLAINT_TYPES[0]).toBe('lost_item');
    expect(COMPLAINT_TYPES).toHaveLength(7);
    for (const type of COMPLAINT_TYPES) {
      // a missing text comes back as its key
      expect(complaintTypeLabel(type)).not.toMatch(/^support\./);
      expect(complaintHint(type)).not.toMatch(/^support\./);
    }
    expect(complaintTypeLabel('lost_item')).toBe('Mashinada narsa qoldi');
    expect(complaintStatusLabel('in_progress')).toBe('Ko‘rib chiqilmoqda');
    expect(resolutionLabel('item_returned')).toBe('Narsangiz qaytarildi');
  });

  it('labels types, statuses and outcomes in Russian', () => {
    setLanguage('ru');
    expect(complaintTypeLabel('lost_item')).toBe('Забыл вещь в машине');
    expect(complaintStatusLabel('in_progress')).toBe('Рассматривается');
    expect(resolutionLabel('refund')).toBe('Деньги возвращены');
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
