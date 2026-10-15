/**
 * Tips ("choychaqa", docs/architecture.md §8 "Tips"): what a rider may give after a ride.
 * Pure rules; the tips module does the I/O and the payment. Texts for the rider are
 * rendered in the language of the request (`tr`).
 */
import { moneyNow, tr } from '../core/i18n/translate.js';

/** The settings document `tips` (admin/settings/tips), as the rules read it. */
export interface TipRules {
  enabled: boolean;
  /** The buttons on the rating screen, so'm. */
  presets: number[];
  /** A custom amount is at most this (and at least `min_amount`). */
  max_amount: number;
  min_amount: number;
  /** Card tips through Payme/Click (cash tips are only recorded). */
  card_enabled: boolean;
  /** A tip can be added this long after the ride completed. */
  window_hours: number;
}

export type TipRefusal = 'disabled' | 'too_small' | 'too_big' | 'not_round' | 'late';

/**
 * Whether a tip of `amount` can be given now: tips on, within the amounts (whole 100 so'm,
 * the smallest note people hand over), within the window after the ride.
 */
export function checkTip(
  amount: number,
  ctx: { completedAt: Date; now: Date },
  rules: TipRules,
): { ok: true } | { ok: false; reason: TipRefusal; message: string } {
  if (!rules.enabled) return no('disabled', tr('Choychaqa hozircha o‘chirilgan'));
  if (!Number.isInteger(amount) || amount < rules.min_amount) {
    return no('too_small', tr('Choychaqa kamida {0}', moneyNow(rules.min_amount)));
  }
  if (amount > rules.max_amount) {
    return no('too_big', tr('Choychaqa ko‘pi bilan {0}', moneyNow(rules.max_amount)));
  }
  if (amount % 100 !== 0) return no('not_round', tr('Summani 100 so‘mga karrali yozing'));
  if (ctx.now.getTime() - ctx.completedAt.getTime() > rules.window_hours * 3600_000) {
    return no('late', tr('Choychaqa safardan keyin faqat bir kun ichida beriladi'));
  }
  return { ok: true };
}

/** 7000 -> '7 000 so‘m'. */
export const soum = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;

function no(reason: TipRefusal, message: string) {
  return { ok: false as const, reason, message };
}
