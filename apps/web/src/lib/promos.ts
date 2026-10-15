import type {
  AdminPromo,
  PromoBody,
  PromoKind,
  PromoRules,
  ReferralStatus,
  RideDiscount,
} from '../api/promo-types';
import type { Tone } from './format';
import { isoToTashkentLocal, som, tashkentLocalToIso } from './format';

/** The promo code editor's draft: numbers null while empty, dates as Tashkent wall clock. */
export interface PromoForm {
  code: string;
  kind: PromoKind;
  value: number | null;
  maxDiscount: number | null;
  minFare: number | null;
  validFrom: string;
  validUntil: string;
  usageLimit: number | null;
  perRiderLimit: number | null;
  firstRideOnly: boolean;
  services: string[];
  classes: string[];
  cityId: string;
  isActive: boolean;
  description: string;
}

export const PROMO_SERVICES: { value: string; label: string }[] = [
  { value: 'taxi', label: 'Taksi' },
  { value: 'delivery', label: 'Yetkazish' },
  { value: 'cargo', label: 'Yuk tashish' },
];

export const PROMO_CLASSES: { value: string; label: string }[] = [
  { value: 'economy', label: 'Ekonom' },
  { value: 'comfort', label: 'Komfort' },
  { value: 'minivan', label: 'Miniven' },
  { value: 'business', label: 'Biznes' },
  { value: 'cargo_s', label: 'Yuk S' },
  { value: 'cargo_m', label: 'Yuk M' },
];

export function emptyPromoForm(): PromoForm {
  return {
    code: '',
    kind: 'percent',
    value: 20,
    maxDiscount: 5000,
    minFare: 0,
    validFrom: '',
    validUntil: '',
    usageLimit: null,
    perRiderLimit: 1,
    firstRideOnly: false,
    services: [],
    classes: [],
    cityId: '',
    isActive: true,
    description: '',
  };
}

export function promoToForm(p: AdminPromo): PromoForm {
  return {
    code: p.code,
    kind: p.kind,
    value: p.value,
    maxDiscount: p.maxDiscount,
    minFare: p.minFare,
    validFrom: p.validFrom ? isoToTashkentLocal(p.validFrom) : '',
    validUntil: p.validUntil ? isoToTashkentLocal(p.validUntil) : '',
    usageLimit: p.usageLimit,
    perRiderLimit: p.perRiderLimit,
    firstRideOnly: p.firstRideOnly,
    services: p.services,
    classes: p.classes,
    cityId: p.cityId ?? '',
    isActive: p.isActive,
    description: p.description ?? '',
  };
}

/** Codes as riders type them and the API stores them: upper-case letters and digits. */
export function normalizePromoCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

/** Field errors of a draft (empty: it can be saved). */
export function promoFormProblems(f: PromoForm): Partial<Record<keyof PromoForm, string>> {
  const p: Partial<Record<keyof PromoForm, string>> = {};
  if (!/^[A-Z0-9]{3,20}$/.test(normalizePromoCode(f.code))) {
    p.code = '3–20 ta lotin harfi va raqam';
  }
  if (f.value === null || f.value < 1) p.value = 'Qiymatni yozing';
  else if (f.kind === 'percent' && f.value > 100) p.value = 'Foiz 1 dan 100 gacha';
  if (f.kind === 'percent' && (f.maxDiscount === null || f.maxDiscount < 1)) {
    p.maxDiscount = 'Foizli kod uchun eng ko‘p chegirma kerak';
  }
  if (f.minFare === null) p.minFare = 'Summani yozing (0 — cheklovsiz)';
  if (f.perRiderLimit === null || f.perRiderLimit < 1) p.perRiderLimit = 'Kamida 1';
  if (f.usageLimit !== null && f.usageLimit < 1) p.usageLimit = 'Kamida 1 yoki bo‘sh';
  const from = f.validFrom ? tashkentLocalToIso(f.validFrom) : null;
  const until = f.validUntil ? tashkentLocalToIso(f.validUntil) : null;
  if (f.validFrom && !from) p.validFrom = 'Sana noto‘g‘ri';
  if (f.validUntil && !until) p.validUntil = 'Sana noto‘g‘ri';
  if (from && until && Date.parse(until) <= Date.parse(from)) {
    p.validUntil = 'Tugash boshlanishidan keyin bo‘lsin';
  }
  if (f.description.length > 300) p.description = 'Ko‘pi bilan 300 belgi';
  return p;
}

/** The request body of a valid draft. */
export function formToBody(f: PromoForm): PromoBody {
  return {
    code: normalizePromoCode(f.code),
    kind: f.kind,
    value: f.value!,
    maxDiscount: f.kind === 'percent' ? f.maxDiscount : null,
    minFare: f.minFare ?? 0,
    validFrom: f.validFrom ? tashkentLocalToIso(f.validFrom) : null,
    validUntil: f.validUntil ? tashkentLocalToIso(f.validUntil) : null,
    usageLimit: f.usageLimit,
    perRiderLimit: f.perRiderLimit ?? 1,
    firstRideOnly: f.firstRideOnly,
    services: f.services,
    classes: f.classes,
    cityId: f.cityId || null,
    isActive: f.isActive,
    description: f.description.trim() || null,
  };
}

/** "20% (5 000 so‘mgacha)" or "3 000 so‘m". */
export function promoValueText(p: Pick<AdminPromo, 'kind' | 'value' | 'maxDiscount'>): string {
  if (p.kind === 'fixed') return som(p.value);
  return p.maxDiscount ? `${p.value}% (${som(p.maxDiscount)}gacha)` : `${p.value}%`;
}

/** The rules besides the amount, for the list: "min 10 000 so‘m · 1-safar · Komfort". */
export function promoRulesText(p: AdminPromo): string {
  const parts: string[] = [];
  if (p.minFare > 0) parts.push(`min ${som(p.minFare)}`);
  if (p.firstRideOnly) parts.push('faqat 1-safar');
  if (p.perRiderLimit > 1) parts.push(`har kimga ${p.perRiderLimit} marta`);
  if (p.services.length) {
    parts.push(p.services.map((s) => labelOf(PROMO_SERVICES, s)).join(', '));
  }
  if (p.classes.length) parts.push(p.classes.map((c) => labelOf(PROMO_CLASSES, c)).join(', '));
  return parts.join(' · ');
}

/** Whether riders can use the code now, as a badge. */
export function promoState(
  p: Pick<AdminPromo, 'isActive' | 'validFrom' | 'validUntil' | 'usageLimit' | 'stats'>,
  now = Date.now(),
): { label: string; tone: Tone } {
  if (!p.isActive) return { label: 'O‘chirilgan', tone: 'neutral' };
  if (p.validUntil && Date.parse(p.validUntil) <= now)
    return { label: 'Muddati tugagan', tone: 'neutral' };
  if (p.validFrom && Date.parse(p.validFrom) > now)
    return { label: 'Hali boshlanmagan', tone: 'blue' };
  if (p.usageLimit !== null && p.stats.redeemed + p.stats.reserved >= p.usageLimit) {
    return { label: 'Limit tugagan', tone: 'amber' };
  }
  return { label: 'Faol', tone: 'green' };
}

/** "12 / 100" uses (reserved included), or "12" without a limit. */
export function usesText(p: Pick<AdminPromo, 'usageLimit' | 'stats'>): string {
  const used = p.stats.redeemed + p.stats.reserved;
  return p.usageLimit === null ? String(used) : `${used} / ${p.usageLimit}`;
}

export const REFERRAL_STATUS: Record<ReferralStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Birinchi safar kutilmoqda', tone: 'blue' },
  rewarded: { label: 'Bonus berildi', tone: 'green' },
  capped: { label: 'Oylik limit: bonussiz', tone: 'amber' },
  revoked: { label: 'Bekor qilingan', tone: 'red' },
};

/** Field errors of the referral and credit settings. */
export function promoRulesProblems(r: PromoRules): Partial<Record<keyof PromoRules, string>> {
  const p: Partial<Record<keyof PromoRules, string>> = {};
  const int = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!int(r.invitee_discount_percent, 0, 100)) p.invitee_discount_percent = '0–100';
  if (!int(r.invitee_max_discount, 0, 10_000_000)) p.invitee_max_discount = 'Summa noto‘g‘ri';
  if (r.invitee_discount_percent > 0 && r.invitee_max_discount <= 0) {
    p.invitee_max_discount = 'Foiz bo‘lsa, eng ko‘p summa ham kerak';
  }
  if (!int(r.invitee_rides, 1, 10)) p.invitee_rides = '1–10';
  if (!int(r.referrer_bonus, 0, 10_000_000)) p.referrer_bonus = 'Summa noto‘g‘ri';
  if (!int(r.monthly_reward_cap, 0, 1000)) p.monthly_reward_cap = '0–1000 (0 — cheklovsiz)';
  if (!int(r.credit_max_percent, 0, 100)) p.credit_max_percent = '0–100';
  if (!int(r.min_rider_pays, 100, 100_000)) p.min_rider_pays = '100–100 000 so‘m';
  if (!/^https:\/\/[^\s]+$/.test(r.invite_url))
    p.invite_url = 'https:// bilan boshlanadigan manzil';
  return p;
}

/** What a ride's discount is made of: "promokod KUZ20 −1 400 so‘m · bonus −2 000 so‘m". */
export function discountText(d: RideDiscount): string {
  const parts: string[] = [];
  if (d.promo) {
    parts.push(
      `${d.promo.source === 'referral' ? 'do‘st taklifi' : 'promokod'} ${d.promo.code} −${som(d.promo.amount)}`,
    );
  }
  if (d.credit > 0) parts.push(`bonus −${som(d.credit)}`);
  if (d.status === 'reserved') parts.push('safar yakunlanganda hisoblanadi');
  return parts.join(' · ');
}

function labelOf(list: { value: string; label: string }[], value: string): string {
  return list.find((x) => x.value === value)?.label ?? value;
}
