import { describe, expect, it } from 'vitest';
import type { AdminPromo } from '../api/promo-types';
import {
  discountText,
  emptyPromoForm,
  formToBody,
  normalizePromoCode,
  promoFormProblems,
  promoRulesProblems,
  promoRulesText,
  promoState,
  promoToForm,
  promoValueText,
  usesText,
} from './promos';

const PROMO: AdminPromo = {
  id: 'p1',
  code: 'KUZ20',
  kind: 'percent',
  value: 20,
  maxDiscount: 5000,
  minFare: 10_000,
  validFrom: '2026-10-01T00:00:00.000Z',
  validUntil: '2026-11-01T00:00:00.000Z',
  usageLimit: 100,
  perRiderLimit: 2,
  firstRideOnly: true,
  services: ['taxi'],
  classes: ['comfort'],
  cityId: null,
  isActive: true,
  description: 'Kuzgi aksiya',
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
  stats: { redeemed: 12, reserved: 3, discountTotal: 54_000, saved: 40 },
};
const NOW = Date.parse('2026-10-15T07:00:00Z');

describe('promo codes in the panel', () => {
  it('describes the amount and the rules', () => {
    expect(promoValueText(PROMO)).toBe('20% (5 000 so‘mgacha)');
    expect(promoValueText({ kind: 'fixed', value: 3000, maxDiscount: null })).toBe('3 000 so‘m');
    expect(promoRulesText(PROMO)).toBe(
      'min 10 000 so‘m · faqat 1-safar · har kimga 2 marta · Taksi · Komfort',
    );
    expect(usesText(PROMO)).toBe('15 / 100');
    expect(usesText({ ...PROMO, usageLimit: null })).toBe('15');
  });

  it('says whether riders can use it now', () => {
    expect(promoState(PROMO, NOW)).toEqual({ label: 'Faol', tone: 'green' });
    expect(promoState({ ...PROMO, isActive: false }, NOW).label).toBe('O‘chirilgan');
    expect(promoState(PROMO, Date.parse('2026-11-02T00:00:00Z')).label).toBe('Muddati tugagan');
    expect(promoState(PROMO, Date.parse('2026-09-01T00:00:00Z')).label).toBe('Hali boshlanmagan');
    expect(promoState({ ...PROMO, usageLimit: 15 }, NOW).label).toBe('Limit tugagan');
  });

  it('round-trips the editor with Tashkent dates', () => {
    const form = promoToForm(PROMO);
    expect(form.validFrom).toBe('2026-10-01T05:00');
    expect(formToBody(form)).toMatchObject({
      code: 'KUZ20',
      kind: 'percent',
      maxDiscount: 5000,
      validFrom: '2026-10-01T00:00:00.000Z',
      validUntil: '2026-11-01T00:00:00.000Z',
      cityId: null,
      description: 'Kuzgi aksiya',
    });
    // a fixed amount has no cap
    expect(formToBody({ ...form, kind: 'fixed', value: 3000 }).maxDiscount).toBeNull();
  });

  it('checks the draft before saving', () => {
    expect(promoFormProblems({ ...emptyPromoForm(), code: 'KUZ20' })).toEqual({});
    const bad = promoFormProblems({
      ...emptyPromoForm(),
      code: 'a',
      value: 120,
      maxDiscount: null,
      validFrom: '2026-10-10T10:00',
      validUntil: '2026-10-09T10:00',
    });
    expect(Object.keys(bad).sort()).toEqual(['code', 'maxDiscount', 'validUntil', 'value']);
    expect(normalizePromoCode(' kuz-20 ')).toBe('KUZ20');
  });

  it('checks the referral and credit rules', () => {
    const rules = {
      referral_enabled: true,
      invitee_discount_percent: 50,
      invitee_max_discount: 10_000,
      invitee_rides: 1,
      referrer_bonus: 10_000,
      monthly_reward_cap: 10,
      credit_max_percent: 50,
      min_rider_pays: 1000,
      invite_url: 'https://taxi.sff.uz/invite',
    };
    expect(promoRulesProblems(rules)).toEqual({});
    expect(
      Object.keys(
        promoRulesProblems({
          ...rules,
          invitee_max_discount: 0,
          invite_url: 'http://x',
          min_rider_pays: 50,
        }),
      ).sort(),
    ).toEqual(['invite_url', 'invitee_max_discount', 'min_rider_pays']);
  });

  it('spells a ride’s discount out', () => {
    expect(
      discountText({
        promo: { id: 'p1', source: 'code', code: 'KUZ20', amount: 1400 },
        credit: 2000,
        total: 3400,
        status: 'redeemed',
      }),
    ).toBe('promokod KUZ20 −1 400 so‘m · bonus −2 000 so‘m');
    expect(
      discountText({
        promo: { id: 'r1', source: 'referral', code: 'ABC234', amount: 3500 },
        credit: 0,
        total: 3500,
        status: 'reserved',
      }),
    ).toBe('do‘st taklifi ABC234 −3 500 so‘m · safar yakunlanganda hisoblanadi');
  });
});
