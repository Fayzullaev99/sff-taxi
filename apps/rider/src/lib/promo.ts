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
import { t } from '../i18n/dictionary';
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
  if (p.kind === 'fixed') return t('profile.promo.fixedDiscount', { amount: formatMoney(p.value) });
  return p.maxDiscount
    ? t('profile.promo.percentDiscountCapped', {
        percent: p.value,
        amount: formatMoney(p.maxDiscount),
      })
    : t('profile.promo.percentDiscount', { percent: p.value });
}

/** A class a code is limited to, in words; an unknown class as the API named it. */
function promoClassName(c: string): string {
  switch (c) {
    case 'economy':
    case 'comfort':
    case 'minivan':
    case 'business':
      return t(`common.classes.${c}`);
    case 'cargo_s':
      return t('profile.promo.cargoS');
    case 'cargo_m':
      return t('profile.promo.cargoM');
    default:
      return c;
  }
}

function promoServiceName(s: string): string {
  return s === 'taxi' || s === 'delivery' || s === 'cargo' ? t(`profile.promo.services.${s}`) : s;
}

/** The conditions riders should know: "Komfort · 10 000 so‘mdan · 31.10 gacha". */
export function promoConditions(p: SavedPromo): string {
  const parts: string[] = [];
  if (p.classes.length) parts.push(p.classes.map(promoClassName).join(', '));
  if (p.services.length) parts.push(p.services.map(promoServiceName).join(', '));
  if (p.minFare > 0) parts.push(t('profile.promo.minFare', { amount: formatMoney(p.minFare) }));
  if (p.firstRideOnly) parts.push(t('profile.promo.firstRideOnly'));
  if (p.validUntil) {
    const until = new Date(Date.parse(p.validUntil) + 5 * 3600_000);
    const date = `${String(until.getUTCDate()).padStart(2, '0')}.${String(until.getUTCMonth() + 1).padStart(2, '0')}`;
    parts.push(t('profile.promo.validUntil', { date }));
  }
  return parts.join(' · ');
}

/** A credit entry's kind in words: "Do‘stingiz uchun bonus", "Safarda ishlatildi". */
export function creditKindLabel(kind: CreditEntry['kind']): string {
  return t(`profile.promo.credit.${kind}`);
}

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
      ? t('profile.promo.inviteGift', {
          percent: card.inviteeDiscountPercent,
          amount: formatMoney(card.inviteeMaxDiscount),
        })
      : t('profile.promo.inviteGiftPlain');
  return t('profile.promo.inviteOffer', { gift, bonus: formatMoney(card.referrerBonus) });
}

/** A ride's discount lines: "Promokod KUZ20" 1 400, "Bonus" 2 000. */
export function rideDiscountLines(fare: FareDiscount): { label: string; amount: number }[] {
  const lines: { label: string; amount: number }[] = [];
  if (fare.promo && fare.promo.amount > 0) {
    lines.push({
      label:
        fare.promo.source === 'referral'
          ? t('profile.promo.referralLine')
          : t('profile.promo.promoLine', { code: fare.promo.code }),
      amount: fare.promo.amount,
    });
  }
  if ((fare.credit ?? 0) > 0) {
    lines.push({ label: t('profile.promo.bonusLine'), amount: fare.credit! });
  }
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
