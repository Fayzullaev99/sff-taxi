import { describe, expect, it } from 'vitest';
import type { Fare } from '../api/types';
import {
  cancellationFeeNote,
  cancelTerms,
  cashToPay,
  quoteOwedFee,
  fareLines,
  optionPriceLabel,
  rideRules,
  seatShareText,
  waitingRuleText,
  waitingState,
} from './fare';

const s = (text: string) => text.replace(/\u00a0/g, ' ');

const cityFare: Fare = {
  kind: 'city',
  rideClass: 'economy',
  distanceM: 6200,
  insideM: 4200,
  outsideM: 2000,
  base: 13_000,
  outside: 3000,
  night: 2600,
  options: { child_seat: 2000, ac: 0 },
  total: 17_600,
  seat: null,
};

describe('fare lines', () => {
  it('splits a city fare into its parts in order', () => {
    const lines = fareLines(cityFare).map((l) => ({ ...l, label: s(l.label) }));
    expect(lines).toEqual([
      { label: 'Shahar ichida, 4,2 km', amount: 10_000 },
      { label: 'Shahar tashqarisi, 2,0 km', amount: 3000 },
      { label: 'Tungi qo‘shimcha', amount: 2600 },
      { label: 'Bolalar o‘rindig‘i', amount: 2000 },
      { label: 'Konditsioner', amount: 0 },
    ]);
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(cityFare.total);
  });

  it('shows the cash rounding and paid waiting', () => {
    const fare: Fare = {
      ...cityFare,
      outside: 0,
      outsideM: 0,
      night: 0,
      options: {},
      base: 7050,
      total: 7100,
    };
    const lines = fareLines(fare, 1500);
    expect(lines.map((l) => l.label)).toEqual([
      expect.stringContaining('Shahar ichida'),
      'Yaxlitlash',
      'Pullik kutish',
    ]);
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(7100 + 1500);
  });

  it('labels an intercity fare and its seat share', () => {
    const fare: Fare = {
      ...cityFare,
      kind: 'intercity',
      distanceM: 118_000,
      base: 200_600,
      outside: 0,
      night: 0,
      options: {},
      total: 200_600,
      seat: { rear: 60_200, front: 66_300 },
    };
    expect(s(fareLines(fare)[0]!.label)).toBe('Shaharlararo, 118 km');
    expect(s(seatShareText(fare)!)).toContain('orqada 60 200 so‘m, oldinda 66 300 so‘m');
    expect(seatShareText(cityFare)).toBeNull();
  });

  it('prices options', () => {
    expect(s(optionPriceLabel(2000))).toBe('+2 000 so‘m');
    expect(optionPriceLabel(0)).toBe('Bepul');
    expect(optionPriceLabel(undefined)).toBe('');
  });
});

describe('waiting', () => {
  const rule = { free_minutes: 2, per_minute: 500 };
  const arrived = '2026-09-26T10:00:00Z';

  it('counts down the free minutes, then charges per started minute', () => {
    expect(waitingState(arrived, rule, new Date('2026-09-26T10:00:30Z'))).toEqual({
      freeLeftS: 90,
      paidMinutes: 0,
      fee: 0,
    });
    expect(waitingState(arrived, rule, new Date('2026-09-26T10:02:00Z'))).toEqual({
      freeLeftS: 0,
      paidMinutes: 0,
      fee: 0,
    });
    expect(waitingState(arrived, rule, new Date('2026-09-26T10:02:01Z')).fee).toBe(500);
    expect(waitingState(arrived, rule, new Date('2026-09-26T10:05:00Z'))).toEqual({
      freeLeftS: 0,
      paidMinutes: 3,
      fee: 1500,
    });
  });
});

describe('cancel terms', () => {
  const rules = { waiting: { free_minutes: 2, per_minute: 500 }, cancellationFee: 3000 };
  const now = new Date('2026-09-26T10:03:00Z');

  it('is free while searching and on the way', () => {
    expect(
      cancelTerms({ status: 'searching', arrivedAt: null, cancelFeeNow: 0 }, rules, now),
    ).toMatchObject({ fee: 0 });
    const onWay = cancelTerms(
      { status: 'driver_assigned', arrivedAt: null, cancelFeeNow: 0 },
      null,
      now,
    );
    expect(onWay.fee).toBe(0);
    expect(onWay.message).toContain('bepul');
  });

  it('is free for rides for later and unpaid card rides; a paid one is refunded', () => {
    const base = { arrivedAt: null, cancelFeeNow: 0 };
    expect(cancelTerms({ ...base, status: 'scheduled' }, null, now).message).toBe(
      'Oldindan buyurtmani bekor qilish bepul.',
    );
    expect(cancelTerms({ ...base, status: 'awaiting_payment' }, null, now).fee).toBe(0);
    // a ride for later's paid deposit: back in time, kept within the last 60 minutes
    const booked = {
      ...base,
      status: 'scheduled' as const,
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      fare: { deposit: 6_000 },
    };
    const early = cancelTerms(
      { ...booked, scheduledFor: new Date(now.getTime() + 3 * 3600_000).toISOString() },
      null,
      now,
    );
    expect(early.fee).toBe(0);
    expect(early.message).toContain('qaytariladi');
    const late = cancelTerms(
      { ...booked, scheduledFor: new Date(now.getTime() + 30 * 60_000).toISOString() },
      null,
      now,
    );
    expect(late.fee).toBe(6_000);
    expect(late.message).toContain('haydovchiga qoladi');
    expect(
      cancelTerms({ ...base, status: 'searching', paymentStatus: 'paid' }, null, now).message,
    ).toMatch(/to‘liq qaytariladi/);
  });

  it('reads the ride’s own rules from the rider view', () => {
    expect(
      rideRules({ rules: { freeWaitingMinutes: 3, waitingPerMinute: 700, cancellationFee: 5000 } }),
    ).toEqual({ waiting: { free_minutes: 3, per_minute: 700 }, cancellationFee: 5000 });
    expect(rideRules({})).toBeNull();
    expect(s(waitingRuleText(rules))).toBe(
      'Haydovchi yetib kelgach 2 daqiqa kutish bepul, keyin har daqiqa 500 so‘m. Shu vaqt tugagach bekor qilish 3 000 so‘m.',
    );
  });

  it('warns before the free waiting runs out', () => {
    const t = cancelTerms(
      { status: 'driver_arrived', arrivedAt: '2026-09-26T10:02:00Z', cancelFeeNow: 0 },
      rules,
      now,
    );
    expect(t.fee).toBe(0);
    expect(s(t.message)).toContain('1 daqiqadan so‘ng bekor qilish 3 000 so‘m');
  });

  it('charges once the free waiting is over, by the clock or by the server', () => {
    const byClock = cancelTerms(
      { status: 'driver_arrived', arrivedAt: '2026-09-26T10:00:00Z', cancelFeeNow: 0 },
      rules,
      now,
    );
    expect(byClock.fee).toBe(3000);
    const byServer = cancelTerms(
      { status: 'driver_arrived', arrivedAt: '2026-09-26T10:00:00Z', cancelFeeNow: 4000 },
      null,
      now,
    );
    expect(byServer.fee).toBe(4000);
    expect(s(byServer.message)).toContain('4 000 so‘m');
  });
});

describe('owed cancellation fees', () => {
  const owed = {
    amount: 5000,
    collectedWith: 'cash' as const,
    label: 'Oldingi bekor qilingan safar uchun to‘lov',
    rides: [{ rideId: 'r1', number: 41, amount: 5000, cancelledAt: '2026-09-26T10:00:00Z' }],
  };

  it('adds the owed fee to a cash ride as its own line', () => {
    const line = quoteOwedFee(owed, 'cash');
    expect(line?.amount).toBe(5000);
    expect(line?.collectedNow).toBe(true);
    expect(s(line!.note)).toContain('Oldingi bekor qilingan safar uchun (#41)');
    expect(s(line!.note)).toContain('5 000 so‘m');
  });

  it('leaves it owed for a card ride and says so', () => {
    const line = quoteOwedFee(owed, 'card');
    expect(line?.collectedNow).toBe(false);
    expect(line?.note).toContain('keyingi naqd safaringizda');
  });

  it('shows nothing when nothing is owed', () => {
    expect(quoteOwedFee(null, 'cash')).toBeNull();
    expect(quoteOwedFee(undefined, 'cash')).toBeNull();
    expect(quoteOwedFee({ ...owed, amount: 0 }, 'cash')).toBeNull();
  });

  it('counts the cash to hand over: fare, paid waiting, owed fees', () => {
    expect(
      cashToPay({
        paymentMethod: 'cash',
        fare: { quoted: 20_000, waiting: 1000, total: null, owedFee: 5000 },
      }),
    ).toEqual({ total: 26_000, fare: 21_000, owedFee: 5000, deposit: 0 });
    expect(
      cashToPay({
        paymentMethod: 'cash',
        fare: { quoted: 20_000, waiting: 1000, total: 21_000 },
      }),
    ).toEqual({ total: 21_000, fare: 21_000, owedFee: 0, deposit: 0 });
    // a shared ride pays its discounted price; a deposit paid in advance is not cash again
    expect(
      cashToPay({
        paymentMethod: 'cash',
        fare: { quoted: 100_000, waiting: 0, total: null, poolDiscount: 15_000, pays: 85_000 },
      }).total,
    ).toBe(85_000);
    expect(
      cashToPay({
        paymentMethod: 'cash',
        fare: { quoted: 30_000, waiting: 500, total: 30_500, deposit: 6_000 },
      }),
    ).toEqual({ total: 24_500, fare: 24_500, owedFee: 0, deposit: 6_000 });
    // a card ride is prepaid: only the paid waiting is cash
    expect(
      cashToPay({
        paymentMethod: 'card',
        fare: { quoted: 20_000, waiting: 1500, total: null, owedFee: 0 },
      }).total,
    ).toBe(1500);
  });

  it('names a fixed route price by seat or whole car', () => {
    const fixed = (mode: 'seat' | 'car', passengers: number) =>
      fareLines({
        ...cityFare,
        base: 20_000,
        outside: 0,
        night: 0,
        options: {},
        total: 20_000,
        fixed: { routeFareId: 'r', mode, price: 10_000, passengers },
      });
    expect(fixed('seat', 2)[0]).toEqual({ label: 'Yo‘nalish narxi: o‘rindiq × 2', amount: 20_000 });
    expect(fixed('car', 1)[0]!.label).toBe('Yo‘nalish narxi: butun mashina');
  });

  it('explains what happened to a cancelled ride own fee', () => {
    expect(cancellationFeeNote({ cancellationFee: 5000, cancellationFeeStatus: 'owed' })).toContain(
      'keyingi naqd safaringiz',
    );
    expect(
      cancellationFeeNote({ cancellationFee: 5000, cancellationFeeStatus: 'waived' }),
    ).toContain('kechirdi');
    expect(
      cancellationFeeNote({ cancellationFee: 5000, cancellationFeeStatus: 'collected' }),
    ).toContain('olingan');
    expect(cancellationFeeNote({ cancellationFee: 5000 })).toContain('bekor qilindi');
  });

  it('tells a cash rider a late cancellation fee comes with the next cash ride', () => {
    const now = new Date('2026-09-27T10:00:00Z');
    const t = cancelTerms(
      { status: 'driver_arrived', arrivedAt: null, cancelFeeNow: 5000, paymentMethod: 'cash' },
      null,
      now,
    );
    expect(t.fee).toBe(5000);
    expect(t.message).toContain('keyingi naqd safaringiz');
  });
});
