import { describe, expect, it } from 'vitest';
import {
  bookingDeposit,
  bookingDepositRules,
  depositAmount,
  freeCancelUntil,
  rideDeposit,
  rideDepositCancel,
  rideDepositRules,
} from './deposit';

const N = ' ';
const rules = { percent: 20, min: 5_000 };

describe('deposit amounts (as the API)', () => {
  it('takes the share rounded up to 1 000, at least the minimum, at most the price', () => {
    expect(depositAmount(30_000, rules)).toBe(6_000);
    expect(depositAmount(31_000, rules)).toBe(7_000);
    expect(depositAmount(12_000, rules)).toBe(5_000);
    expect(depositAmount(4_000, rules)).toBe(4_000);
    expect(depositAmount(30_000, { percent: 0, min: 5_000 })).toBe(0);
  });

  it('uses the quote’s own amount for the class, the rule for another price', () => {
    const deposit = {
      ...rules,
      amount: 6_000,
      amounts: { economy: 6_000, comfort: 8_000 },
      freeCancelMinutes: 60,
    };
    expect(rideDeposit(deposit, 'comfort', 38_000, 38_000)).toBe(8_000);
    expect(rideDeposit(deposit, 'economy', 20_000, 30_000)).toBe(5_000);
    expect(rideDeposit(null, 'economy', 30_000, 30_000)).toBeNull();
  });
});

describe('a ride for later', () => {
  const at = '2026-09-30T05:00:00Z';

  it('is free to cancel until 60 minutes before its time', () => {
    expect(freeCancelUntil(at).toISOString()).toBe('2026-09-30T04:00:00.000Z');
    expect(rideDepositCancel(6_000, at, new Date('2026-09-30T03:59:00Z'))).toEqual({
      refund: true,
      message: `Depozit 6${N}000${N}so‘m kartangizga qaytariladi.`,
    });
    expect(rideDepositCancel(6_000, at, new Date('2026-09-30T04:10:00Z')).refund).toBe(false);
  });

  it('says the rules before paying', () => {
    const text = rideDepositRules(6_000, 30_000, at);
    expect(text).toContain(`6${N}000${N}so‘m oldindan to‘lov`);
    expect(text).toContain(`qolgan 24${N}000${N}so‘m naqd`);
    expect(text).toContain('60 daqiqa oldingacha');
  });
});

describe('a seat on the trip board', () => {
  it('splits the price into the card deposit and the cash', () => {
    expect(bookingDeposit(70_000, { ...rules, paymentMinutes: 15 })).toEqual({
      deposit: 14_000,
      cash: 56_000,
    });
    expect(bookingDeposit(70_000, null)).toBeNull();
    expect(bookingDeposit(70_000, { percent: 0, min: 0, paymentMinutes: 15 })).toBeNull();
    expect(bookingDepositRules({ deposit: 14_000, cash: 56_000 }, 15, 60)).toContain(
      '15 daqiqa ichida',
    );
  });
});
