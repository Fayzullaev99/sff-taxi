import { afterEach, describe, expect, it } from 'vitest';
import type { QuoteDiscounts, ReferralCard, SavedPromo } from '../api/promo-types';
import { setLanguage } from '../i18n/dictionary';
import { cashToPay } from './fare';
import {
  classDiscount,
  codeReady,
  creditKindLabel,
  discountSentence,
  inviteCodeFromUrl,
  inviteMessage,
  inviteOffer,
  normalizeCode,
  orderDiscount,
  promoConditions,
  promoValueText,
  rideDiscountLines,
} from './promo';

const DISCOUNTS: QuoteDiscounts = {
  creditBalance: 10_000,
  classes: {
    economy: {
      promo: { id: 'p1', source: 'code', code: 'KUZ20', description: null, amount: 1400 },
      promoNote: null,
      credit: 2800,
      total: 4200,
      fare: 7000,
      pays: 2800,
    },
    comfort: {
      promo: null,
      promoNote: 'Promokod «Komfort» sinfi uchun emas',
      credit: 0,
      total: 0,
      fare: 8800,
      pays: 8800,
    },
  },
  notes: [],
};
const NOW_OPTS = { later: false, shared: false, useCredit: true };

afterEach(() => setLanguage('uz'));
/** formatMoney groups with no-break spaces. */
function sp(t: string): string;
function sp(t: string[]): string[];
function sp(t: string | string[]): string | string[] {
  const plain = (x: string) => x.split(String.fromCharCode(160)).join(' ');
  return Array.isArray(t) ? t.map(plain) : plain(t);
}

describe('discounts on the order screen', () => {
  it('shows the class’s promo and credit, and sends exactly that', () => {
    const d = classDiscount(DISCOUNTS, 'economy', NOW_OPTS);
    expect(d).toMatchObject({ total: 4200, pays: 2800, credit: 2800 });
    expect(orderDiscount(d)).toEqual({ promoId: 'p1', useCredit: true });
  });

  it('leaves the credit out when the rider turns it off', () => {
    const d = classDiscount(DISCOUNTS, 'economy', { ...NOW_OPTS, useCredit: false });
    expect(d).toMatchObject({ total: 1400, pays: 5600, credit: 0 });
    expect(orderDiscount(d)).toEqual({ promoId: 'p1', useCredit: false });
  });

  it('says why a code does not apply, and gives nothing for later or shared rides', () => {
    expect(classDiscount(DISCOUNTS, 'comfort', NOW_OPTS)).toMatchObject({
      total: 0,
      pays: 8800,
      note: 'Promokod «Komfort» sinfi uchun emas',
    });
    expect(classDiscount(DISCOUNTS, 'economy', { ...NOW_OPTS, later: true })).toBeNull();
    expect(classDiscount(DISCOUNTS, 'economy', { ...NOW_OPTS, shared: true })).toBeNull();
    expect(classDiscount(null, 'economy', NOW_OPTS)).toBeNull();
    expect(orderDiscount(null)).toEqual({ promoId: null, useCredit: false });
  });
});

describe('codes and the invitation', () => {
  const promo: SavedPromo = {
    id: 'p1',
    code: 'KUZ20',
    kind: 'percent',
    value: 20,
    maxDiscount: 5000,
    minFare: 10_000,
    validUntil: '2026-10-31T18:59:00.000Z',
    firstRideOnly: true,
    services: [],
    classes: ['comfort'],
    description: null,
    usable: true,
    reason: null,
    usesLeft: 1,
    addedAt: '2026-10-10T10:00:00.000Z',
  };

  it('reads a code’s value and conditions', () => {
    expect(sp(promoValueText(promo))).toBe('20% chegirma, 5 000 so‘mgacha');
    expect(sp(promoValueText({ kind: 'fixed', value: 3000, maxDiscount: null }))).toBe(
      '3 000 so‘m chegirma',
    );
    expect(sp(promoConditions(promo))).toBe(
      'Komfort · 10 000 so‘mdan · birinchi safar uchun · 31.10 gacha',
    );
  });

  it('reads them in Russian when the app does', () => {
    setLanguage('ru');
    expect(sp(promoValueText(promo))).toBe('Скидка 20%, до 5 000 сум');
    expect(sp(promoConditions(promo))).toBe(
      'Комфорт · от 10 000 сум · на первую поездку · до 31.10',
    );
    expect(creditKindLabel('referral_bonus')).toBe('Бонус за друга');
    expect(
      rideDiscountLines({ promo: { id: 'p1', source: 'code', code: 'KUZ20', amount: 1400 } }),
    ).toEqual([{ label: 'Промокод KUZ20', amount: 1400 }]);
  });

  it('normalises typed codes and finds the code in an invitation link', () => {
    expect(normalizeCode(' kuz-20 ')).toBe('KUZ20');
    expect(codeReady('ab')).toBe(false);
    expect(codeReady('abc 234')).toBe(true);
    expect(inviteCodeFromUrl('sfftaxi://invite/abc234')).toBe('ABC234');
    expect(inviteCodeFromUrl('https://taxi.sff.uz/invite/ABC234?x=1')).toBe('ABC234');
    expect(inviteCodeFromUrl('https://taxi.sff.uz/t/xyz')).toBeNull();
  });

  it('shares one message with the code and the link', () => {
    const card: ReferralCard = {
      enabled: true,
      code: 'ABC234',
      deepLink: 'sfftaxi://invite/ABC234',
      url: 'https://taxi.sff.uz/invite/ABC234',
      shareText: 'Mening kodim ABC234: https://taxi.sff.uz/invite/ABC234',
      inviteeDiscountPercent: 50,
      inviteeMaxDiscount: 10_000,
      inviteeRides: 1,
      referrerBonus: 10_000,
      invited: 0,
      rewarded: 0,
      earned: 0,
    };
    expect(inviteMessage(card)).toBe('Mening kodim ABC234: https://taxi.sff.uz/invite/ABC234');
    expect(inviteMessage({ ...card, shareText: 'Kod ABC234' })).toBe(
      'Kod ABC234 https://taxi.sff.uz/invite/ABC234',
    );
    expect(sp(inviteOffer(card))).toBe(
      'Do‘stingizga birinchi safarga 50% chegirma (10 000 so‘mgacha), sizga u safarni yakunlagach 10 000 so‘m bonus.',
    );
    setLanguage('ru');
    expect(sp(inviteOffer(card))).toBe(
      'Другу — скидка 50% (до 10 000 сум) на первую поездку, вам — бонус 10 000 сум, когда он её завершит.',
    );
  });

  it('spells out a ride’s discount and the cash after it', () => {
    const lines = rideDiscountLines({
      promo: { id: 'p1', source: 'code', code: 'KUZ20', amount: 1400 },
      credit: 2000,
    });
    expect(lines).toEqual([
      { label: 'Promokod KUZ20', amount: 1400 },
      { label: 'Bonus', amount: 2000 },
    ]);
    expect(sp(discountSentence(lines))).toBe('Promokod KUZ20 −1 400 so‘m · Bonus −2 000 so‘m');
    expect(
      rideDiscountLines({ promo: { id: 'r', source: 'referral', code: 'X', amount: 3500 } }),
    ).toEqual([{ label: 'Do‘st taklifi', amount: 3500 }]);
    // completed: the total stays the full fare, the rider paid it less the discount
    expect(
      cashToPay({
        paymentMethod: 'cash',
        fare: { quoted: 7000, waiting: 500, total: 7500, pays: 5600, discount: 1400 },
      }).fare,
    ).toBe(6100);
    // on the way: the price after the discount, waiting not yet known
    expect(
      cashToPay({
        paymentMethod: 'cash',
        fare: { quoted: 7000, waiting: 0, total: null, pays: 5600, discount: 1400 },
      }).fare,
    ).toBe(5600);
  });
});
