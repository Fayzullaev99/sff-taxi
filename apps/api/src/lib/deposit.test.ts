import { describe, expect, it } from 'vitest';
import { depositAmount } from './deposit.js';

const RULES = { deposit_percent: 20, deposit_min: 5000 };

describe('booking deposits', () => {
  it('is nothing when deposits are off', () => {
    expect(depositAmount(70_000, { ...RULES, deposit_percent: 0 })).toBe(0);
    expect(depositAmount(0, RULES)).toBe(0);
  });

  it('takes the share rounded up to whole 1 000 so‘m', () => {
    // 20% of 70 000
    expect(depositAmount(70_000, RULES)).toBe(14_000);
    // 20% of 150 000
    expect(depositAmount(150_000, RULES)).toBe(30_000);
    // 20% of 51 500 = 10 300 -> 11 000
    expect(depositAmount(51_500, RULES)).toBe(11_000);
  });

  it('asks at least the minimum, never more than the price', () => {
    // 20% of 16 900 = 3 380 -> 4 000, below the minimum
    expect(depositAmount(16_900, RULES)).toBe(5000);
    expect(depositAmount(4000, RULES)).toBe(4000);
    expect(depositAmount(10_500, { deposit_percent: 100, deposit_min: 0 })).toBe(10_500);
  });
});
