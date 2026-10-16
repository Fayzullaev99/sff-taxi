/**
 * Rider discounts (docs/architecture.md §8 "Rider discounts"): promo codes made by operators,
 * the referral welcome discount and ride credit. Pure rules; the promos module does the I/O
 * and the locking. Amounts are whole so'm; a discount is rounded down to 100 so'm so the
 * cash the rider hands over stays a round amount (fares are rounded to 100 so'm).
 * Texts for the rider are rendered in the language of the request (`tr`).
 */
import { moneyNow, tr } from '../core/i18n/translate.js';

export type PromoKind = 'percent' | 'fixed';

export interface PromoRule {
  code: string;
  kind: PromoKind;
  /** Percent (1-100) or so'm. */
  value: number;
  maxDiscount: number | null;
  minFare: number;
  validFrom: Date | null;
  validUntil: Date | null;
  usageLimit: number | null;
  perRiderLimit: number;
  firstRideOnly: boolean;
  /** Empty: every service / class. */
  services: string[];
  classes: string[];
  cityId: string | null;
  isActive: boolean;
}

/** Why a code does not apply; `message` is what the rider reads. */
export type PromoRefusal =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'exhausted'
  | 'used'
  | 'first_ride'
  | 'city'
  | 'service'
  | 'class'
  | 'min_fare';

export type PromoCheck = { ok: true } | { ok: false; reason: PromoRefusal; message: string };

/** The settings document `promo` (admin/settings/promo), as the rules read it. */
export interface DiscountRules {
  /** Ride credit pays at most this share of a fare. */
  credit_max_percent: number;
  /** Whatever the discounts, the rider pays at least this much for the trip. */
  min_rider_pays: number;
}

export interface ReferralRules {
  referral_enabled: boolean;
  /** The invitee's welcome discount on their first ride(s). */
  invitee_discount_percent: number;
  invitee_max_discount: number;
  invitee_rides: number;
  /** Ride credit for the referrer after the invitee's first completed ride. */
  referrer_bonus: number;
  /** Rewarded referrals per referrer per Tashkent month (0 = no limit). */
  monthly_reward_cap: number;
}

const CLASS_LABELS: Record<string, string> = {
  economy: 'Ekonom',
  comfort: 'Komfort',
  minivan: 'Miniven',
  business: 'Biznes',
  cargo_s: 'Kichik yuk mashinasi',
  cargo_m: 'O‘rta yuk mashinasi',
};
const SERVICE_LABELS: Record<string, string> = {
  taxi: 'Taksi',
  cargo: 'Yuk tashish',
  delivery: 'Yetkazib berish',
};

/** 7000 -> '7 000 so‘m'. */
export const soum = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;

/** A Tashkent date "15.10.2026". */
function tashkentDate(d: Date): string {
  const t = new Date(d.getTime() + 5 * 3600_000);
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${t.getUTCFullYear()}`;
}

/** What a rider typed, as codes are stored: upper-case, without spaces and dashes. */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

export const CODE_PATTERN = /^[A-Z0-9]{3,20}$/;

/** Rounded down to whole 100 so'm. */
const floor100 = (n: number) => Math.max(0, Math.floor(n / 100) * 100);

/**
 * Whether the rider may use the code at all, before a fare is known: switched on, within its
 * dates, its total and per-rider uses left (`totalUses`, `riderUses`: rides that reserved or
 * redeemed it), a first-ride code for a rider without completed rides, the city.
 */
export function checkPromo(
  p: PromoRule,
  ctx: {
    now: Date;
    totalUses: number;
    riderUses: number;
    completedRides: number;
    /** The quote's city; null when not known yet (entering the code in the profile). */
    cityId: string | null;
  },
): PromoCheck {
  if (!p.isActive) return refuse('inactive', tr('Bu promokod faol emas'));
  if (p.validFrom && ctx.now < p.validFrom) {
    return refuse('not_started', tr('Promokod {0} dan amal qiladi', tashkentDate(p.validFrom)));
  }
  if (p.validUntil && ctx.now >= p.validUntil) {
    return refuse('expired', tr('Promokod muddati tugagan'));
  }
  if (p.usageLimit !== null && ctx.totalUses >= p.usageLimit) {
    return refuse('exhausted', tr('Promokodning limiti tugagan'));
  }
  if (ctx.riderUses >= p.perRiderLimit) {
    return refuse('used', tr('Siz bu promokoddan foydalanib bo‘lgansiz'));
  }
  if (p.firstRideOnly && ctx.completedRides > 0) {
    return refuse('first_ride', tr('Bu promokod faqat birinchi safar uchun'));
  }
  if (p.cityId && ctx.cityId && p.cityId !== ctx.cityId) {
    return refuse('city', tr('Promokod bu shaharda amal qilmaydi'));
  }
  return { ok: true };
}

/**
 * The code's discount on one class of a quote: the service, the class and the minimum fare
 * must fit; a percent is taken of the fare and capped; never the whole fare.
 */
export function promoDiscount(
  p: Pick<PromoRule, 'kind' | 'value' | 'maxDiscount' | 'minFare' | 'services' | 'classes'>,
  fare: { total: number; service: string; rideClass: string },
): { ok: true; discount: number } | { ok: false; reason: PromoRefusal; message: string } {
  if (p.services.length && !p.services.includes(fare.service)) {
    const label = SERVICE_LABELS[fare.service];
    return refuse('service', tr('Promokod «{0}» uchun emas', label ? tr(label) : fare.service));
  }
  if (p.classes.length && !p.classes.includes(fare.rideClass)) {
    const label = CLASS_LABELS[fare.rideClass];
    return refuse(
      'class',
      tr('Promokod «{0}» sinfi uchun emas', label ? tr(label) : fare.rideClass),
    );
  }
  if (fare.total < p.minFare) {
    return refuse('min_fare', tr('Promokod {0}dan qimmat safarlar uchun', moneyNow(p.minFare)));
  }
  const raw =
    p.kind === 'percent'
      ? Math.min((fare.total * p.value) / 100, p.maxDiscount ?? Number.POSITIVE_INFINITY)
      : p.value;
  return { ok: true, discount: floor100(Math.min(raw, fare.total)) };
}

/** The referral welcome discount on a fare: the percent, capped (0 when off). */
export function welcomeDiscount(fare: number, rules: ReferralRules): number {
  if (!rules.referral_enabled || rules.invitee_discount_percent <= 0) return 0;
  return floor100(
    Math.min((fare * rules.invitee_discount_percent) / 100, rules.invitee_max_discount, fare),
  );
}

export interface RiderDiscount {
  /** The promo code's (or the welcome) discount actually given. */
  promo: number;
  /** Ride credit spent. */
  credit: number;
  total: number;
  /** What the rider pays for the trip (before waiting and owed fees). */
  pays: number;
}

/**
 * The whole discount on a fare: the promo (or welcome) discount first, then ride credit on
 * what is left, at most `credit_max_percent` of the fare and the balance. The rider always
 * pays at least `min_rider_pays` (a card payment cannot be 0, cash stays meaningful): the
 * credit gives way first, then the promo.
 */
export function riderDiscount(
  fare: number,
  input: { promo: number; creditBalance: number },
  rules: DiscountRules,
): RiderDiscount {
  const room = Math.max(0, fare - Math.min(rules.min_rider_pays, fare));
  const promo = Math.min(floor100(input.promo), floor100(room));
  const creditCap = floor100((fare * rules.credit_max_percent) / 100);
  const credit = Math.min(floor100(Math.max(0, input.creditBalance)), creditCap, room - promo);
  const c = Math.max(0, floor100(credit));
  return { promo, credit: c, total: promo + c, pays: fare - promo - c };
}

/** Whether a referrer still gets a reward this month. */
export function rewardAllowed(rewardedThisMonth: number, rules: ReferralRules): boolean {
  return rules.monthly_reward_cap <= 0 || rewardedThisMonth < rules.monthly_reward_cap;
}

/** Letters and digits riders cannot confuse (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A personal invitation code: 6 unambiguous characters; `random(n)` is 0..n-1. */
export function makeReferralCode(random: (n: number) => number, length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[random(ALPHABET.length)];
  return code;
}

/** The invitation the rider shares: the app's deep link and the web page for other phones. */
export function inviteLinks(code: string, webBase: string) {
  const web = `${webBase.replace(/\/+$/, '')}/${encodeURIComponent(code)}`;
  return {
    deepLink: `sfftaxi://invite/${encodeURIComponent(code)}`,
    url: web,
  };
}

/** The share text: what the invitee gets, the code and the link. */
export function inviteText(code: string, url: string, rules: ReferralRules): string {
  const gift =
    rules.invitee_discount_percent > 0
      ? tr(
          'birinchi safaringizga {0}% chegirma ({1}gacha)',
          rules.invitee_discount_percent,
          moneyNow(rules.invitee_max_discount),
        )
      : tr('sovg‘a');
  return tr(
    'SFF Taxi — Guliston taksisi, narx oldindan ma’lum. Mening kodim {0} bilan {1}: {2}',
    code,
    gift,
    url,
  );
}

function refuse(reason: PromoRefusal, message: string) {
  return { ok: false as const, reason, message };
}
