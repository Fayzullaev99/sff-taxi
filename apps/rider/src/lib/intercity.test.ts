import { describe, expect, it } from 'vitest';
import {
  alongParams,
  alongRouteParams,
  boardingHint,
  bookingCancelledText,
  bookingCancelTerms,
  bookingPrice,
  cancelRulesFrom,
  cancelRuleText,
  DEFAULT_CANCEL_RULES,
  frontSurcharge,
  searchDates,
  stopLines,
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

describe('intercity cancellation rules from the API', () => {
  const departure = '2026-09-27T10:00:00Z';

  it('takes the most specific readable rules, else the defaults', () => {
    expect(cancelRulesFrom(null, undefined)).toEqual(DEFAULT_CANCEL_RULES);
    expect(
      cancelRulesFrom(
        { freeCancelMinutes: 120, lateCancelFeePercent: 50 },
        { freeCancelMinutes: 60, lateCancelFeePercent: 30 },
      ),
    ).toEqual({ freeCancelMinutes: 120, lateCancelFeePercent: 50 });
    expect(
      cancelRulesFrom(
        { freeCancelMinutes: -1, lateCancelFeePercent: 50 },
        { freeCancelMinutes: 90, lateCancelFeePercent: 20 },
      ),
    ).toEqual({ freeCancelMinutes: 90, lateCancelFeePercent: 20 });
  });

  it('uses the published rules for the free time and the share', () => {
    const rules = { freeCancelMinutes: 120, lateCancelFeePercent: 50 };
    const early = bookingCancelTerms(departure, 70_000, new Date('2026-09-27T07:59:00Z'), rules);
    expect(early.fee).toBe(0);
    expect(early.freeUntil?.toISOString()).toBe('2026-09-27T08:00:00.000Z');
    expect(early.message).toContain('50%');
    const late = bookingCancelTerms(departure, 70_000, new Date('2026-09-27T08:00:00Z'), rules);
    expect(late.fee).toBe(35_000);
    expect(s(late.message)).toContain('120 daqiqadan kam');
  });

  it('prefers the booking own free-until time and fee', () => {
    const server = { freeUntil: '2026-09-27T08:30:00Z', feeNow: 0 };
    const before = bookingCancelTerms(
      departure,
      70_000,
      new Date('2026-09-27T08:29:00Z'),
      DEFAULT_CANCEL_RULES,
      server,
    );
    expect(before.fee).toBe(0);
    // the free time ran out after the booking was fetched: the clock catches it
    const after = bookingCancelTerms(
      departure,
      70_000,
      new Date('2026-09-27T08:31:00Z'),
      DEFAULT_CANCEL_RULES,
      server,
    );
    expect(after.fee).toBe(21_000);
    const byServer = bookingCancelTerms(
      departure,
      70_000,
      new Date('2026-09-27T09:10:00Z'),
      DEFAULT_CANCEL_RULES,
      { freeUntil: null, feeNow: 20_000 },
    );
    expect(byServer.fee).toBe(20_000);
  });

  it('says free cancellation when no share is kept', () => {
    const rules = { freeCancelMinutes: 60, lateCancelFeePercent: 0 };
    expect(bookingCancelTerms(departure, 70_000, new Date('2026-09-27T09:30:00Z'), rules).fee).toBe(
      0,
    );
    expect(cancelRuleText(rules)).toContain('bepul');
    expect(cancelRuleText({ freeCancelMinutes: 90, lateCancelFeePercent: 25 })).toContain(
      '90 daqiqa',
    );
  });
});

describe('deposits on the trip board', () => {
  const departure = '2026-09-30T10:00:00Z';
  it('refunds a paid deposit in the free time and keeps it later', () => {
    const early = bookingCancelTerms(
      departure,
      70_000,
      new Date('2026-09-30T08:00:00Z'),
      undefined,
      {
        deposit: 14_000,
      },
    );
    expect(early.fee).toBe(0);
    expect(early.message).toContain('qaytariladi');
    const late = bookingCancelTerms(
      departure,
      70_000,
      new Date('2026-09-30T09:30:00Z'),
      undefined,
      {
        deposit: 14_000,
      },
    );
    expect(late.fee).toBe(14_000);
    expect(late.message).toContain('haydovchiga qoladi');
  });

  it('cancels an unpaid booking for free and explains a system cancellation', () => {
    expect(
      bookingCancelTerms(departure, 70_000, new Date('2026-09-30T09:30:00Z'), undefined, {
        unpaid: true,
      }),
    ).toEqual({
      fee: 0,
      freeUntil: null,
      message: 'Depozit hali to‘lanmagan: bekor qilish bepul.',
    });
    expect(
      bookingCancelledText({
        status: 'cancelled',
        cancelledBy: 'system',
        cancelReason: null,
        cancellationFee: 0,
        depositAmount: 14_000,
      }),
    ).toContain('Depozit o‘z vaqtida to‘lanmadi');
  });
});

describe('a seat along the way', () => {
  const trip = {
    alongTheWay: true,
    pickup: { slug: 'guliston', nameUz: 'Guliston' },
    dropoff: { slug: 'sirdaryo', nameUz: 'Sirdaryo' },
    price: { rear: 25_000, front: 28_000 },
  };

  it('carries the rider’s towns and part price to the trip screen and back', () => {
    const params = alongRouteParams(trip);
    expect(params).toMatchObject({ along: '1', from: 'guliston', to: 'sirdaryo', rear: '25000' });
    expect(alongParams(params)).toEqual({
      from: 'guliston',
      to: 'sirdaryo',
      fromName: 'Guliston',
      toName: 'Sirdaryo',
      prices: { rear: 25_000, front: 28_000 },
    });
  });

  it('carries nothing for a direct trip and ignores broken params', () => {
    expect(alongRouteParams({ ...trip, alongTheWay: false })).toEqual({});
    expect(alongParams({})).toBeNull();
    expect(alongParams({ along: '1', from: 'a', to: 'b', rear: 'x', front: '1' })).toBeNull();
  });
});

describe('where a rider along the way gets in', () => {
  const trip = { meetingPoint: 'Guliston avtovokzali', distanceM: 132_000 };
  const along = {
    alongTheWay: true,
    boardingPoint: {
      name: 'Sirdaryo',
      meetingPoint: 'Sirdaryo markazi, bozor yonida',
      estimatedAt: '2026-10-01T03:50:00Z', // 08:50 in Tashkent
    },
    alightingPoint: { name: 'Toshkent', meetingPoint: 'Olmazor avtoturargohi' },
    partDistanceM: 85_700,
  };

  it('names the rider’s own town’s meeting point, about when, and their part', () => {
    expect(stopLines(along, trip).map((l) => [l.label, s(l.value)])).toEqual([
      ['O‘tirish joyi', 'Sirdaryo: Sirdaryo markazi, bozor yonida'],
      ['Vaqti', 'taxminan 08:50'],
      ['Tushish joyi', 'Toshkent: Olmazor avtoturargohi'],
      ['Masofa', s(stopLines({ alongTheWay: false }, { ...trip, distanceM: 85_700 })[1]!.value)],
    ]);
    expect(boardingHint(along)).toBe('Sirdaryo · taxminan 08:50');
  });

  it('keeps the trip’s meeting point and distance for a whole seat (or an older API)', () => {
    const lines = stopLines({ ...along, alongTheWay: false }, trip);
    expect(lines.map((l) => l.label)).toEqual(['Uchrashuv joyi', 'Masofa']);
    expect(lines[0]!.value).toBe('Guliston avtovokzali');
    expect(stopLines({ alongTheWay: true }, trip)[0]!.label).toBe('Uchrashuv joyi');
    expect(boardingHint({ alongTheWay: true })).toBeNull();
  });

  it('carries the stops to the trip screen', () => {
    const params = alongRouteParams({
      ...along,
      pickup: { slug: 'sirdaryo', nameUz: 'Sirdaryo' },
      dropoff: { slug: 'toshkent', nameUz: 'Toshkent' },
      price: { rear: 51_000, front: 59_000 },
    });
    expect(alongParams(params)?.stops).toEqual({
      boardingPoint: along.boardingPoint,
      alightingPoint: along.alightingPoint,
      partDistanceM: 85_700,
    });
    expect(alongParams({ ...params, boardAt: 'soon' })?.stops).toBeUndefined();
  });
});
