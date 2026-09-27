import { describe, expect, it } from 'vitest';
import {
  bookingCancelledText,
  bookingCancelTerms,
  bookingPrice,
  frontSurcharge,
  searchDates,
} from './intercity';

const prices = { rear: 70_000, front: 80_000 };
const s = (text: string) => text.replace(/\u00a0/g, ' ');

describe('intercity', () => {
  it('prices a booking like the API (one front seat at the front price)', () => {
    expect(bookingPrice(1, false, prices)).toBe(70_000);
    expect(bookingPrice(2, false, prices)).toBe(140_000);
    expect(bookingPrice(1, true, prices)).toBe(80_000);
    expect(bookingPrice(3, true, prices)).toBe(220_000);
    expect(frontSurcharge(prices)).toBe(10_000);
  });

  it('is free to cancel until 60 minutes before departure, then 30%', () => {
    const departure = '2026-09-27T10:00:00Z';
    const early = bookingCancelTerms(departure, 70_000, new Date('2026-09-27T08:59:00Z'));
    expect(early.fee).toBe(0);
    expect(early.freeUntil?.toISOString()).toBe('2026-09-27T09:00:00.000Z');
    // 14:00 Tashkent
    expect(early.message).toMatch(/14:00 gacha bekor qilish bepul/);
    const late = bookingCancelTerms(departure, 70_000, new Date('2026-09-27T09:00:00Z'));
    expect(late.fee).toBe(21_000);
    expect(s(late.message)).toMatch(/21 000 so‘m/);
    // rounded to 100 so'm like the API
    expect(bookingCancelTerms(departure, 71_150, new Date('2026-09-27T09:30:00Z')).fee).toBe(
      21_300,
    );
  });

  it('offers today, tomorrow and the next days in Tashkent', () => {
    // 20:30 UTC is already 01:30 on the 28th in Tashkent
    const dates = searchDates(new Date('2026-09-27T20:30:00Z'), 3);
    expect(dates).toEqual([
      { value: '2026-09-28', label: 'Bugun' },
      { value: '2026-09-29', label: 'Ertaga' },
      { value: '2026-09-30', label: '30 sentabr' },
    ]);
  });

  it('explains why a booking ended', () => {
    const b = { cancelledBy: null, cancelReason: null, cancellationFee: 0 };
    expect(bookingCancelledText({ ...b, status: 'booked' })).toBeNull();
    expect(bookingCancelledText({ ...b, status: 'no_show' })).toMatch(/yo‘q edingiz/);
    expect(
      bookingCancelledText({
        ...b,
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelReason: 'Mashina buzildi',
      }),
    ).toBe('Haydovchi qatnovni bekor qildi: Mashina buzildi.');
    expect(
      s(
        bookingCancelledText({
          ...b,
          status: 'cancelled',
          cancelledBy: 'rider',
          cancellationFee: 21_000,
        })!,
      ),
    ).toBe('Siz bronni bekor qildingiz. Bekor qilish to‘lovi: 21 000 so‘m.');
  });
});
