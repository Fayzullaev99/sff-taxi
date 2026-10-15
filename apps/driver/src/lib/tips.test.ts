import { describe, expect, it } from 'vitest';
import { tipLine } from './tips';

const plain = (s: string | null) => (s ? s.split(String.fromCharCode(160)).join(' ') : s);

describe('tips for the driver', () => {
  it('says how the tip comes', () => {
    expect(plain(tipLine({ amount: 5000, method: 'cash', status: 'recorded' }))).toBe(
      'Yo‘lovchi 5 000 so‘m choychaqa beradi (naqd)',
    );
    expect(plain(tipLine({ amount: 7000, method: 'card', status: 'paid' }))).toBe(
      'Choychaqa 7 000 so‘m kartadan — balansingizga to‘liq tushdi',
    );
    expect(plain(tipLine({ amount: 7000, method: 'card', status: 'awaiting_payment' }))).toMatch(
      /to‘lamoqda$/,
    );
    expect(tipLine({ amount: 7000, method: 'card', status: 'failed' })).toBeNull();
  });
});
