/**
 * Promo codes, the invitation discount and ride credit on the rider's screens: what a class
 * costs with them, what the order sends, how codes and credit entries read. Pure (tested).
 */
import type {
  ClassDiscount,
  CreditEntry,
  FareDiscount,
  QuoteDiscounts,
  ReferralCard,
  SavedPromo,
} from '../api/promo-types';
import { formatMoney } from './format';

export interface AppliedDiscount {
  promo: ClassDiscount['promo'];
  credit: number;
  total: number;
  fare: number;
  pays: number;
  /** Why the saved code does not apply to this class. */
  note: string | null;
}

/**
 * The discount the order screen shows (and sends) for a class: none for a ride for later or
 * a shared ride (the API refuses them), the credit left out when the rider turned it off.
 */
export function classDiscount(
  discounts: QuoteDiscounts | null | undefined,
  rideClass: string,
  opts: { later: boolean; shared: boolean; useCredit: boolean },
): AppliedDiscount | null {
  if (!discounts?.classes || opts.later || opts.shared) return null;
  const d = discounts.classes[rideClass];
  if (!d) return null;
  const credit = opts.useCredit ? d.credit : 0;
  const promo = d.promo?.amount ?? 0;
  const total = promo + credit;
  if (total <= 0) return d.promoNote ? { ...empty(d), note: d.promoNote } : null;
  return { promo: d.promo, credit, total, fare: d.fare, pays: d.fare - total, note: d.promoNote };
}

function empty(d: ClassDiscount): AppliedDiscount {
  return { promo: null, credit: 0, total: 0, fare: d.fare, pays: d.fare, note: null };
}

/** The order's discount fields: exactly what the quote showed. */
export function orderDiscount(d: AppliedDiscount | null): {
  promoId: string | null;
  useCredit: boolean;
} {
  return { promoId: d?.promo?.id ?? null, useCredit: (d?.credit ?? 0) > 0 };
}

/** "20% chegirma, 5 000 so‘mgacha" or "3 000 so‘m chegirma". */
export function promoValueText(p: Pick<SavedPromo, 'kind' | 'value' | 'maxDiscount'>): string {
  if (p.kind === 'fixed') return `${formatMoney(p.value)} chegirma`;
  return p.maxDiscount
    ? `${p.value}% chegirma, ${formatMoney(p.maxDiscount)}gacha`
    : `${p.value}% chegirma`;
}

const CLASS_NAMES: Record<string, string> = {
  economy: 'Ekonom',
  comfort: 'Komfort',
  minivan: 'Miniven',
  business: 'Biznes',
  cargo_s: 'Kichik yuk',
  cargo_m: 'O‘rta yuk',
};
const SERVICE_NAMES: Record<string, string> = {
  taxi: 'taksi',
  delivery: 'yetkazish',
  cargo: 'yuk tashish',
};

/** The conditions riders should know: "Komfort · 10 000 so‘mdan · 31.10 gacha". */
export function promoConditions(p: SavedPromo): string {
  const parts: string[] = [];
  if (p.classes.length) parts.push(p.classes.map((c) => CLASS_NAMES[c] ?? c).join(', '));
  if (p.services.length) parts.push(p.services.map((s) => SERVICE_NAMES[s] ?? s).join(', '));
  if (p.minFare > 0) parts.push(`${formatMoney(p.minFare)}dan`);
  if (p.firstRideOnly) parts.push('birinchi safar uchun');
  if (p.validUntil) {
    const t = new Date(Date.parse(p.validUntil) + 5 * 3600_000);
    parts.push(
      `${String(t.getUTCDate()).padStart(2, '0')}.${String(t.getUTCMonth() + 1).padStart(2, '0')} gacha`,
    );
  }
  return parts.join(' · ');
}

export const CREDIT_KIND_LABELS: Record<CreditEntry['kind'], string> = {
  referral_bonus: 'Do‘stingiz uchun bonus',
  ride: 'Safarda ishlatildi',
  ride_release: 'Bekor qilingan safar: qaytarildi',
  revoke: 'Bonus bekor qilindi',
  adjustment: 'Tuzatish',
};

/** The invitation as one share message: the API's text already carries the code and link. */
export function inviteMessage(card: Pick<ReferralCard, 'shareText' | 'url' | 'code'>): string {
  return card.shareText.includes(card.url)
    ? card.shareText
    : `${card.shareText} ${card.url}`.trim();
}

/** What the invitation gives, for the card: "Do‘stingizga 50% (10 000 so‘mgacha), sizga 10 000 so‘m". */
export function inviteOffer(card: ReferralCard): string {
  const gift =
    card.inviteeDiscountPercent > 0
      ? `${card.inviteeDiscountPercent}% chegirma (${formatMoney(card.inviteeMaxDiscount)}gacha)`
      : 'chegirma';
  return `Do‘stingizga birinchi safarga ${gift}, sizga u safarni yakunlagach ${formatMoney(card.referrerBonus)} bonus.`;
}

/** A ride's discount lines: "Promokod KUZ20" 1 400, "Bonus" 2 000. */
export function rideDiscountLines(fare: FareDiscount): { label: string; amount: number }[] {
  const lines: { label: string; amount: number }[] = [];
  if (fare.promo && fare.promo.amount > 0) {
    lines.push({
      label: fare.promo.source === 'referral' ? 'Do‘st taklifi' : `Promokod ${fare.promo.code}`,
      amount: fare.promo.amount,
    });
  }
  if ((fare.credit ?? 0) > 0) lines.push({ label: 'Bonus', amount: fare.credit! });
  return lines;
}

/** The lines in one sentence: "Promokod KUZ20 −1 400 so‘m · Bonus −2 000 so‘m". */
export function discountSentence(lines: { label: string; amount: number }[]): string {
  return lines.map((l) => `${l.label} −${formatMoney(l.amount)}`).join(' · ');
}

/** An invitation code or promo code as typed: upper-case, without spaces. */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

/** Typed enough to send (the API says the rest). */
export function codeReady(input: string): boolean {
  return /^[A-Z0-9]{3,20}$/.test(normalizeCode(input));
}

/** The code from an invitation link: sfftaxi://invite/CODE or https://…/invite/CODE. */
export function inviteCodeFromUrl(url: string): string | null {
  const m = /\/invite\/([A-Za-z0-9]{3,20})(?:[/?#]|$)/.exec(url);
  return m ? m[1]!.toUpperCase() : null;
}
