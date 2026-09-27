import { describe, expect, it } from 'vitest';
import type { RidePayment } from '../api/types';
import { cardLabel, cardMoneyNote, checkoutLinks, paymentSecondsLeft } from './payment';

const payment = (extra: Partial<RidePayment> = {}): RidePayment => ({
  id: 'i1',
  amount: 12_000,
  status: 'pending',
  provider: null,
  expiresAt: '2026-09-27T10:10:00Z',
  paidAt: null,
  refundRequestedAt: null,
  refundedAt: null,
  checkout: {
    click: 'https://my.click.uz/services/pay?x=1',
    payme: 'https://checkout.paycom.uz/abc',
  },
  ...extra,
});

const s = (text: string | undefined) => text?.replace(/\u00a0/g, ' ');

describe('card payments', () => {
  it('names the providers on the card choice', () => {
    expect(cardLabel(['click', 'payme'])).toBe('Karta (Payme, Click)');
    expect(cardLabel(['click'])).toBe('Karta (Click)');
    expect(cardLabel(undefined)).toBe('Karta');
  });

  it('lists the checkout links while the payment is pending, Payme first', () => {
    expect(checkoutLinks(payment()).map((l) => l.provider)).toEqual(['payme', 'click']);
    expect(checkoutLinks(payment()).map((l) => l.label)).toEqual([
      'Payme orqali to‘lash',
      'Click orqali to‘lash',
    ]);
    expect(checkoutLinks(payment({ status: 'paid', checkout: null }))).toEqual([]);
    expect(checkoutLinks(null)).toEqual([]);
    // never open anything but a https page
    expect(checkoutLinks(payment({ checkout: { payme: 'javascript:alert(1)' } }))).toEqual([]);
  });

  it('counts down the 10-minute payment window', () => {
    const p = payment();
    expect(paymentSecondsLeft(p, new Date('2026-09-27T10:05:00Z'))).toBe(300);
    expect(paymentSecondsLeft(p, new Date('2026-09-27T10:11:00Z'))).toBe(0);
    expect(paymentSecondsLeft(payment({ status: 'paid' }), new Date())).toBeNull();
  });

  it('says what happened to the money', () => {
    const ride = {
      status: 'cancelled' as const,
      paymentMethod: 'card' as const,
      fare: { quoted: 12_000 },
      payment: payment({ status: 'refund_pending', checkout: null }),
    };
    expect(cardMoneyNote({ ...ride, paymentStatus: 'refund_pending' })?.title).toBe(
      'Pul kartangizga qaytariladi',
    );
    expect(s(cardMoneyNote({ ...ride, paymentStatus: 'refund_pending' })?.message)).toMatch(
      /12 000 so‘m/,
    );
    expect(cardMoneyNote({ ...ride, paymentStatus: 'refunded' })?.tone).toBe('success');
    expect(cardMoneyNote({ ...ride, paymentStatus: 'failed' })?.title).toBe(
      'To‘lov amalga oshmadi',
    );
    expect(cardMoneyNote({ ...ride, paymentStatus: 'not_charged' })?.title).toBe(
      'Kartadan pul yechilmadi',
    );
    expect(
      cardMoneyNote({ ...ride, paymentMethod: 'cash', paymentStatus: 'not_charged' }),
    ).toBeNull();
  });
});
