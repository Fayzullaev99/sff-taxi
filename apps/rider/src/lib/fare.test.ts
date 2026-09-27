import { describe, expect, it } from 'vitest';
import type { Fare } from '../api/types';
import {
  cancelTerms,
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
