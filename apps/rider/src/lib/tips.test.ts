import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/dictionary';
import {
  parseTipAmount,
  tipAmountError,
  tipEditable,
  tipStatusText,
  type TipRulesView,
} from './tips';

const RULES: TipRulesView = {
  enabled: true,
  presets: [2000, 5000, 10_000],
  min: 1000,
  max: 50_000,
  card: true,
  until: null,
  open: true,
};
const plain = (s: string | null) => (s ? s.split(String.fromCharCode(160)).join(' ') : s);

afterEach(() => setLanguage('uz'));

describe('tips in Russian', () => {
  it('words the amount errors and the status line in Russian', () => {
    setLanguage('ru');
    expect(plain(tipAmountError(500, RULES))).toBe('Не меньше 1 000 сум');
    expect(tipAmountError(null, RULES)).toBe('Введите сумму цифрами');
    expect(plain(tipStatusText({ amount: 5000, method: 'cash', status: 'recorded' }))).toBe(
      'Спасибо! Передайте водителю 5 000 сум чаевых наличными.',
    );
  });
});

describe('tips on the rating screen', () => {
  it('reads typed amounts', () => {
    expect(parseTipAmount('5 000')).toBe(5000);
    expect(parseTipAmount('7000 so‘m')).toBe(7000);
    expect(parseTipAmount('12.000')).toBe(12_000);
    expect(parseTipAmount('abc')).toBeNull();
    expect(parseTipAmount('')).toBeNull();
  });

  it('checks the amount against the rules', () => {
    expect(tipAmountError(5000, RULES)).toBeNull();
    expect(plain(tipAmountError(500, RULES))).toBe('Kamida 1 000 so‘m');
    expect(plain(tipAmountError(60_000, RULES))).toBe('Ko‘pi bilan 50 000 so‘m');
    expect(tipAmountError(2550, RULES)).toBe('Summani 100 so‘mga karrali yozing');
    expect(tipAmountError(null, RULES)).toBe('Summani raqam bilan yozing');
  });

  it('says what happens after the tip and whether it can still change', () => {
    expect(plain(tipStatusText({ amount: 5000, method: 'cash', status: 'recorded' }))).toBe(
      'Rahmat! 5 000 so‘m choychaqani haydovchiga naqd bering.',
    );
    expect(plain(tipStatusText({ amount: 5000, method: 'card', status: 'paid' }))).toMatch(
      /kartadan to‘landi/,
    );
    expect(tipEditable(null, RULES)).toBe(true);
    expect(tipEditable({ status: 'failed' }, RULES)).toBe(true);
    expect(tipEditable({ status: 'paid' }, RULES)).toBe(false);
    expect(tipEditable(null, { ...RULES, open: false })).toBe(false);
  });
});
