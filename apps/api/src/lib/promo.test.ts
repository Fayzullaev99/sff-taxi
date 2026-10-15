import { describe, expect, it } from 'vitest';
import {
  checkPromo,
  inviteLinks,
  inviteText,
  makeReferralCode,
  normalizeCode,
  type PromoRule,
  promoDiscount,
  type ReferralRules,
  rewardAllowed,
  riderDiscount,
  welcomeDiscount,
} from './promo.js';

const NOW = new Date('2026-10-14T07:00:00Z');
const PROMO: PromoRule = {
  code: 'GULISTON20',
  kind: 'percent',
  value: 20,
  maxDiscount: 5000,
  minFare: 0,
  validFrom: null,
  validUntil: null,
  usageLimit: null,
  perRiderLimit: 1,
  firstRideOnly: false,
  services: [],
  classes: [],
  cityId: null,
  isActive: true,
};
const CTX: Parameters<typeof checkPromo>[1] = {
  now: NOW,
  totalUses: 0,
  riderUses: 0,
  completedRides: 3,
  cityId: 'city-1',
};
const REFERRAL: ReferralRules = {
  referral_enabled: true,
  invitee_discount_percent: 50,
  invitee_max_discount: 10_000,
  invitee_rides: 1,
  referrer_bonus: 10_000,
  monthly_reward_cap: 10,
};
const RULES = { credit_max_percent: 50, min_rider_pays: 1000 };

describe('promo codes', () => {
  it('normalises what riders type', () => {
    expect(normalizeCode(' guliston-20 ')).toBe('GULISTON20');
    expect(normalizeCode('sff taxi')).toBe('SFFTAXI');
  });

  it('accepts a code within its dates and limits', () => {
    expect(checkPromo(PROMO, CTX)).toEqual({ ok: true });
  });

  it('refuses with the reason in Uzbek', () => {
    const reason = (p: Partial<PromoRule>, ctx: Partial<typeof CTX> = {}) => {
      const r = checkPromo({ ...PROMO, ...p }, { ...CTX, ...ctx });
      return r.ok ? null : [r.reason, r.message];
    };
    expect(reason({ isActive: false })).toEqual(['inactive', 'Bu promokod faol emas']);
    expect(reason({ validFrom: new Date('2026-10-20T00:00:00Z') })).toEqual([
      'not_started',
      'Promokod 20.10.2026 dan amal qiladi',
    ]);
    expect(reason({ validUntil: NOW })?.[0]).toBe('expired');
    expect(reason({ usageLimit: 100 }, { totalUses: 100 })?.[0]).toBe('exhausted');
    expect(reason({}, { riderUses: 1 })).toEqual([
      'used',
      'Siz bu promokoddan foydalanib bo‘lgansiz',
    ]);
    expect(reason({ perRiderLimit: 3 }, { riderUses: 2 })).toBeNull();
    expect(reason({ firstRideOnly: true })?.[0]).toBe('first_ride');
    expect(reason({ firstRideOnly: true }, { completedRides: 0 })).toBeNull();
    expect(reason({ cityId: 'city-2' })?.[0]).toBe('city');
    // the profile does not know the city yet: checked again on the quote
    expect(reason({ cityId: 'city-2' }, { cityId: null })).toBeNull();
  });

  it('takes a percent of the fare, capped and rounded down to 100 so‘m', () => {
    const fare = { total: 7000, service: 'taxi', rideClass: 'economy' };
    expect(promoDiscount(PROMO, fare)).toEqual({ ok: true, discount: 1400 });
    expect(promoDiscount(PROMO, { ...fare, total: 40_000 })).toEqual({ ok: true, discount: 5000 });
    // 15% of 7 300 = 1 095 -> 1 000
    expect(promoDiscount({ ...PROMO, value: 15 }, { ...fare, total: 7300 })).toEqual({
      ok: true,
      discount: 1000,
    });
  });

  it('gives a fixed amount, never more than the fare', () => {
    const fixed = { ...PROMO, kind: 'fixed' as const, value: 8000, maxDiscount: null };
    expect(promoDiscount(fixed, { total: 12_000, service: 'taxi', rideClass: 'economy' })).toEqual({
      ok: true,
      discount: 8000,
    });
    expect(promoDiscount(fixed, { total: 5000, service: 'taxi', rideClass: 'economy' })).toEqual({
      ok: true,
      discount: 5000,
    });
  });

  it('applies only to its services, classes and from its minimum fare', () => {
    const p = { ...PROMO, services: ['taxi'], classes: ['comfort'], minFare: 10_000 };
    const r1 = promoDiscount(p, { total: 20_000, service: 'cargo', rideClass: 'cargo_s' });
    expect(r1.ok ? null : r1.message).toBe('Promokod «Yuk tashish» uchun emas');
    const r2 = promoDiscount(p, { total: 20_000, service: 'taxi', rideClass: 'economy' });
    expect(r2.ok ? null : r2.message).toBe('Promokod «Ekonom» sinfi uchun emas');
    const r3 = promoDiscount(p, { total: 8800, service: 'taxi', rideClass: 'comfort' });
    expect(r3.ok ? null : r3.message).toBe('Promokod 10 000 so‘mdan qimmat safarlar uchun');
    expect(promoDiscount(p, { total: 12_500, service: 'taxi', rideClass: 'comfort' }).ok).toBe(
      true,
    );
  });
});

describe('the whole rider discount', () => {
  it('spends credit after the promo, up to half of the fare', () => {
    expect(riderDiscount(10_000, { promo: 2000, creditBalance: 10_000 }, RULES)).toEqual({
      promo: 2000,
      credit: 5000,
      total: 7000,
      pays: 3000,
    });
    expect(riderDiscount(10_000, { promo: 0, creditBalance: 2500 }, RULES)).toEqual({
      promo: 0,
      credit: 2500,
      total: 2500,
      pays: 7500,
    });
  });

  it('leaves the rider at least the minimum to pay: credit gives way first', () => {
    expect(riderDiscount(5000, { promo: 5000, creditBalance: 10_000 }, RULES)).toEqual({
      promo: 4000,
      credit: 0,
      total: 4000,
      pays: 1000,
    });
    expect(riderDiscount(5000, { promo: 3000, creditBalance: 10_000 }, RULES)).toEqual({
      promo: 3000,
      credit: 1000,
      total: 4000,
      pays: 1000,
    });
  });

  it('is nothing without a promo or credit', () => {
    expect(riderDiscount(7000, { promo: 0, creditBalance: 0 }, RULES)).toEqual({
      promo: 0,
      credit: 0,
      total: 0,
      pays: 7000,
    });
  });
});

describe('referrals', () => {
  it('gives the invitee the welcome percent, capped', () => {
    expect(welcomeDiscount(7000, REFERRAL)).toBe(3500);
    expect(welcomeDiscount(40_000, REFERRAL)).toBe(10_000);
    expect(welcomeDiscount(7000, { ...REFERRAL, referral_enabled: false })).toBe(0);
  });

  it('rewards up to the monthly cap (0 = no cap)', () => {
    expect(rewardAllowed(9, REFERRAL)).toBe(true);
    expect(rewardAllowed(10, REFERRAL)).toBe(false);
    expect(rewardAllowed(500, { ...REFERRAL, monthly_reward_cap: 0 })).toBe(true);
  });

  it('makes codes riders cannot misread', () => {
    let i = 0;
    const code = makeReferralCode(() => i++ % 31);
    expect(code).toBe('ABCDEF');
    expect(makeReferralCode(() => 30)).toBe('999999');
    expect(makeReferralCode(() => 0)).not.toMatch(/[01OIL]/);
  });

  it('shares a deep link, a web link and a text', () => {
    const links = inviteLinks('ABC234', 'https://taxi.example.uz/invite/');
    expect(links).toEqual({
      deepLink: 'sfftaxi://invite/ABC234',
      url: 'https://taxi.example.uz/invite/ABC234',
    });
    expect(inviteText('ABC234', links.url, REFERRAL)).toBe(
      'SFF Taxi — Guliston taksisi, narx oldindan ma’lum. Mening kodim ABC234 bilan birinchi safaringizga 50% chegirma (10 000 so‘mgacha): https://taxi.example.uz/invite/ABC234',
    );
  });
});
