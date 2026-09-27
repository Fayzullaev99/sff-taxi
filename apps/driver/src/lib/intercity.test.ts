import { describe, expect, it } from 'vitest';
import {
  departureIso,
  departureProblem,
  frontPriceFor,
  parseTime,
  priceProblem,
  seatsSold,
  stepPrice,
  tripActions,
} from './intercity';
import { parseTopupAmount, suggestedTopup, topupPhase, topupPollMs } from './topup';
import { dayLabel, minutesUntil, scheduledLabel, tashkentDate, whenLabel } from './when';

// 2026-09-27 10:00 in Tashkent
const NOW = Date.parse('2026-09-27T05:00:00Z');

describe('Tashkent time', () => {
  it('reads dates and labels in Tashkent whatever the phone says', () => {
    expect(tashkentDate(Date.parse('2026-09-27T19:30:00Z'))).toBe('2026-09-28');
    expect(tashkentDate(NOW, 1)).toBe('2026-09-28');
    expect(dayLabel('2026-09-27', NOW)).toBe('Bugun');
    expect(dayLabel('2026-09-28', NOW)).toBe('Ertaga');
    expect(dayLabel('2026-10-02', NOW)).toBe('02.10');
    expect(whenLabel('2026-09-28T02:00:00Z', NOW)).toBe('Ertaga 07:00');
    expect(scheduledLabel('2026-09-27T13:30:00Z', NOW)).toBe('Oldindan buyurtma · Bugun 18:30');
    expect(scheduledLabel(null, NOW)).toBeNull();
    expect(minutesUntil('2026-09-27T05:45:30Z', NOW)).toBe(45);
  });
});

describe('publishing a departure', () => {
  it('reads times the way drivers type them', () => {
    expect(parseTime('7:05')).toBe('07:05');
    expect(parseTime('18.30')).toBe('18:30');
    expect(parseTime('0630')).toBe('06:30');
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('ertalab')).toBeNull();
  });

  it('builds the Tashkent instant and checks how far ahead it is', () => {
    const iso = departureIso('2026-09-27', '10:10');
    expect(iso).toBe('2026-09-27T10:10:00+05:00');
    expect(departureProblem(iso, NOW)).toMatch(/15 daqiqadan/);
    expect(departureProblem(departureIso('2026-09-27', '10:30'), NOW)).toBeNull();
    expect(departureProblem(departureIso('2026-10-05', '10:30'), NOW)).toMatch(/7 kundan/);
  });

  it('keeps the price within the band and on hundreds', () => {
    const band = { min: 59_500, max: 80_500 };
    expect(priceProblem(70_000, band)).toBeNull();
    expect(priceProblem(70_050, band)).toMatch(/100/);
    expect(priceProblem(90_000, band)).toMatch(/59 500–80 500/);
    expect(stepPrice(80_000, 1_000, band)).toBe(80_500);
    expect(stepPrice(60_000, -1_000, band)).toBe(59_500);
    expect(stepPrice(70_000, 1_000, band)).toBe(71_000);
  });

  it('prices the front seat like the API', () => {
    const reference = { rear: 70_000, front: 80_000 };
    expect(frontPriceFor(70_000, reference)).toBe(80_000);
    expect(frontPriceFor(65_000, reference)).toBe(74_300);
  });
});

describe('running a trip', () => {
  const departureAt = '2026-09-27T06:30:00Z'; // 11:30 Tashkent
  const bookings = [
    { status: 'booked', seats: 2 },
    { status: 'boarded', seats: 1 },
    { status: 'cancelled', seats: 1 },
  ];

  it('opens boarding an hour before departure', () => {
    const early = tripActions({ status: 'scheduled', departureAt, bookings }, NOW);
    expect(early).toMatchObject({ canOpenBoarding: false, canDepart: false, canCancel: true });
    expect(early.boardingOpensAt).toBe(Date.parse('2026-09-27T05:30:00Z'));
    const later = tripActions({ status: 'scheduled', departureAt, bookings }, NOW + 31 * 60_000);
    expect(later).toMatchObject({ canOpenBoarding: true, boardingOpensAt: null });
  });

  it('departs with someone aboard and arrives after departing', () => {
    const boarding = tripActions({ status: 'boarding', departureAt, bookings }, NOW);
    expect(boarding).toMatchObject({ canDepart: true, waiting: 2, aboard: 1, canBoard: true });
    const empty = tripActions(
      { status: 'boarding', departureAt, bookings: [{ status: 'booked', seats: 1 }] },
      NOW,
    );
    expect(empty.canDepart).toBe(false);
    expect(tripActions({ status: 'departed', departureAt, bookings }, NOW)).toMatchObject({
      canArrive: true,
      canCancel: false,
      canBoard: false,
    });
    expect(seatsSold(bookings)).toBe(3);
  });
});

describe('card top-ups', () => {
  const limits = { min: 5_000, max: 5_000_000 };

  it('reads the amount and enforces the limits', () => {
    expect(parseTopupAmount('50 000', limits)).toEqual({ amount: 50_000 });
    expect(parseTopupAmount('1000', limits)).toEqual({ error: 'Kamida 5 000 so‘m' });
    expect(parseTopupAmount('9 000 000', limits)).toEqual({ error: 'Ko‘pi bilan 5 000 000 so‘m' });
    expect(parseTopupAmount('ellik', limits)).toHaveProperty('error');
  });

  it('suggests enough to go online again', () => {
    expect(suggestedTopup(2_500, limits)).toBe(5_000);
    expect(suggestedTopup(12_300, limits)).toBe(13_000);
    expect(suggestedTopup(0, limits)).toBe(5_000);
  });

  it('knows when the payment is final and polls fast at first', () => {
    expect(topupPhase('pending')).toBe('waiting');
    expect(topupPhase('paid')).toBe('paid');
    expect(topupPhase('expired')).toBe('failed');
    expect(topupPollMs(0, 60_000)).toBe(3_000);
    expect(topupPollMs(0, 180_000)).toBe(10_000);
  });
});
