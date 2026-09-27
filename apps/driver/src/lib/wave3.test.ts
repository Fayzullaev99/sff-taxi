import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERCITY_RULES,
  mapDriverConfig,
  mapPublicConfig,
  storeUrlFor,
} from './driver-config';
import { departureParts, tripEditable, tripEdits } from './intercity';
import { pushTarget } from './refresh';
import { cashBreakdown, cashPartsText, offerOwedFeeLine, owedFeeNote } from './ride-flow';
import { topupPollMs, topupRefetchMs, withPaidEvent } from './topup';
import { isPdfDocument } from './upload-flow';

describe('intercity rules from /driver/config', () => {
  it('takes the published rules', () => {
    const c = mapDriverConfig({
      intercity: {
        publishMinMinutesAhead: 30,
        publishMaxDaysAhead: 5,
        tripSpacingHours: 3,
        boardingOpensMinutes: 45,
        priceBandPercent: 20,
        freeCancelMinutes: 90,
        lateCancelFeePercent: 40,
      },
    });
    expect(c.intercity).toEqual({
      publishMinMinutesAhead: 30,
      publishMaxDaysAhead: 5,
      tripSpacingHours: 3,
      boardingOpensMinutes: 45,
      priceBandPercent: 20,
      freeCancelMinutes: 90,
      lateCancelFeePercent: 40,
    });
  });

  it('keeps the launch default for a missing or malformed field', () => {
    expect(mapDriverConfig({}).intercity).toEqual(DEFAULT_INTERCITY_RULES);
    const c = mapDriverConfig({
      intercity: { publishMaxDaysAhead: '9', boardingOpensMinutes: 30 },
    });
    expect(c.intercity.publishMaxDaysAhead).toBe(DEFAULT_INTERCITY_RULES.publishMaxDaysAhead);
    expect(c.intercity.boardingOpensMinutes).toBe(30);
  });
});

describe('/config: no forced update and store links', () => {
  it('reads a null minimum version as no forced update', () => {
    const c = mapPublicConfig({ minAppVersion: { rider: null, driver: null } });
    expect(c.minDriverVersion).toBeNull();
  });

  it('takes the driver store links per platform', () => {
    const c = mapPublicConfig({
      storeUrls: {
        rider: { android: 'https://play.google.com/store/apps/details?id=rider', ios: null },
        driver: {
          android: 'https://play.google.com/store/apps/details?id=uz.sff.taxi.driver',
          ios: 'itms-apps://apps.apple.com/app/id1',
        },
      },
    });
    expect(storeUrlFor(c.storeUrls, 'android')).toBe(
      'https://play.google.com/store/apps/details?id=uz.sff.taxi.driver',
    );
    expect(storeUrlFor(c.storeUrls, 'ios')).toBe('itms-apps://apps.apple.com/app/id1');
    expect(storeUrlFor(c.storeUrls, 'web')).toBeNull();
  });

  it('falls back (null) for missing or unsafe links', () => {
    expect(mapPublicConfig({}).storeUrls).toEqual({ android: null, ios: null });
    const c = mapPublicConfig({
      storeUrls: { driver: { android: 'javascript:alert(1)', ios: '  ' } },
    });
    expect(c.storeUrls).toEqual({ android: null, ios: null });
  });
});

describe('cash to collect', () => {
  const fare = { quoted: 20_000, waiting: 1_000, total: null as number | null };

  it('uses the API collectCash and splits out the owed fee', () => {
    const cash = cashBreakdown({
      paymentMethod: 'cash',
      fare: { ...fare, owedFee: 3_000 },
      collectCash: 24_000,
    });
    expect(cash).toEqual({ total: 24_000, fare: 20_000, waiting: 1_000, owedFee: 3_000 });
    expect(cashPartsText(cash)).toBe(
      'Narx 20 000 so‘m + kutish 1 000 so‘m + oldingi safar 3 000 so‘m',
    );
    expect(owedFeeNote(cash.owedFee)).toBe(
      'shundan 3 000 so‘m — yo‘lovchining oldingi bekor qilingan safari uchun',
    );
  });

  it('follows the live waiting timer on top of collectCash', () => {
    const cash = cashBreakdown(
      { paymentMethod: 'cash', fare: { ...fare, waiting: 0, owedFee: 3_000 }, collectCash: 23_000 },
      1_500,
    );
    expect(cash.total).toBe(24_500);
    expect(cash.waiting).toBe(1_500);
  });

  it('a card ride: only the waiting in cash', () => {
    const cash = cashBreakdown({ paymentMethod: 'card', fare, collectCash: 1_000 });
    expect(cash).toEqual({ total: 1_000, fare: 0, waiting: 1_000, owedFee: 0 });
    expect(cashPartsText(cash)).toBeNull();
    expect(owedFeeNote(0)).toBeNull();
  });

  it('falls back to fare + waiting + owed fee without collectCash (older API)', () => {
    expect(cashBreakdown({ paymentMethod: 'cash', fare }).total).toBe(21_000);
    expect(
      cashBreakdown({ paymentMethod: 'cash', fare: { ...fare, total: 21_000, owedFee: 2_000 } })
        .total,
    ).toBe(23_000);
    expect(cashBreakdown({ paymentMethod: 'card', fare }).total).toBe(1_000);
    expect(cashBreakdown({ paymentMethod: 'cash', fare: { ...fare, waiting: 0 } }, 500).total).toBe(
      20_500,
    );
  });

  it('shows the owed fee on the offer only when there is one', () => {
    expect(offerOwedFeeLine(3_000)).toBe('+ 3 000 so‘m oldingi bekor qilingan safar uchun (naqd)');
    expect(offerOwedFeeLine(0)).toBeNull();
    expect(offerOwedFeeLine(undefined)).toBeNull();
  });
});

describe('watching a top-up', () => {
  const T0 = 1_000_000;

  it('polls fast without the stream, slowly as a fallback with it, never once final', () => {
    expect(topupRefetchMs(undefined, T0, T0 + 1_000, false)).toBe(3_000);
    expect(topupRefetchMs('pending', T0, T0 + 200_000, false)).toBe(10_000);
    expect(topupRefetchMs('pending', T0, T0 + 1_000, true)).toBe(15_000);
    expect(topupPollMs(T0, T0, true)).toBe(15_000);
    expect(topupRefetchMs('paid', T0, T0, false)).toBe(false);
    expect(topupRefetchMs('expired', T0, T0, true)).toBe(false);
  });

  it('the paid event marks the watched top-up paid (and so stops the polling)', () => {
    const t = { id: 'i1', status: 'pending', amount: 50_000 };
    const paid = withPaidEvent(t, { intentId: 'i1', status: 'paid', amount: 50_000 });
    expect(paid?.status).toBe('paid');
    expect(topupRefetchMs(paid?.status, T0, T0, true)).toBe(false);
    // another payment, nothing cached, or a push without the amount
    expect(withPaidEvent(t, { intentId: 'i2', status: 'paid', amount: 1 })).toBe(t);
    expect(withPaidEvent(undefined, { intentId: 'i1', status: 'paid', amount: 1 })).toBeUndefined();
    expect(withPaidEvent(t, { intentId: 'i1', status: 'paid', amount: 0 })?.amount).toBe(50_000);
  });
});

describe('pushes of wave 3', () => {
  const id = '0192f0a4-1b2c-7d3e-8f40-123456789abc';

  it('a paid top-up opens its screen, an answered appeal the appeals', () => {
    expect(pushTarget({ kind: 'topup_paid', intentId: id.toUpperCase() })).toEqual({
      kind: 'topup',
      intentId: id,
    });
    expect(pushTarget({ kind: 'topup_paid' })).toEqual({ kind: 'topup', intentId: null });
    expect(pushTarget({ kind: 'appeal_resolved', appealId: id })).toEqual({
      kind: 'appeal',
      appealId: id,
    });
  });
});

describe('editing a trip', () => {
  const trip = {
    status: 'scheduled',
    departureAt: '2026-09-28T02:00:00.000Z',
    seats: { total: 4, free: 4, frontOffered: true },
    price: { rear: 60_000 },
    meetingPoint: null as string | null,
    comment: null as string | null,
    bookings: [] as { status: string }[],
  };

  it('is editable only while announced and nobody holds a seat', () => {
    expect(tripEditable(trip)).toBe(true);
    expect(tripEditable({ ...trip, status: 'boarding' })).toBe(false);
    expect(tripEditable({ ...trip, seats: { ...trip.seats, free: 3 } })).toBe(false);
    expect(tripEditable({ ...trip, bookings: [{ status: 'booked' }] })).toBe(false);
    expect(tripEditable({ ...trip, bookings: [{ status: 'cancelled' }] })).toBe(true);
  });

  it('reads the departure back into the form in Tashkent time', () => {
    expect(departureParts('2026-09-28T02:00:00.000Z')).toEqual({
      date: '2026-09-28',
      time: '07:00',
    });
    expect(departureParts('2026-09-27T20:30:00+00:00')).toEqual({
      date: '2026-09-28',
      time: '01:30',
    });
  });

  it('sends only what changed', () => {
    const form = {
      departureAt: '2026-09-28T07:00:00+05:00',
      seats: 4,
      frontSeat: true,
      priceRear: 60_000,
      meetingPoint: '',
      comment: ' ',
    };
    expect(tripEdits(trip, form)).toBeNull();
    expect(
      tripEdits(trip, {
        ...form,
        departureAt: '2026-09-28T08:30:00+05:00',
        seats: 3,
        priceRear: 62_000,
        comment: 'Konditsioner bor',
      }),
    ).toEqual({
      departureAt: '2026-09-28T08:30:00+05:00',
      seats: 3,
      priceRear: 62_000,
      comment: 'Konditsioner bor',
    });
    expect(
      tripEdits(
        { ...trip, meetingPoint: 'Bozor oldi', comment: 'x' },
        { ...form, frontSeat: false },
      ),
    ).toEqual({ frontSeat: false, meetingPoint: null, comment: null });
  });
});

describe('document type', () => {
  it('knows a PDF by its contentType, not its link', () => {
    expect(isPdfDocument({ contentType: 'application/pdf' })).toBe(true);
    expect(isPdfDocument({ contentType: 'image/jpeg' })).toBe(false);
    expect(isPdfDocument({ contentType: null })).toBe(false);
    expect(isPdfDocument(null)).toBe(false);
  });
});
