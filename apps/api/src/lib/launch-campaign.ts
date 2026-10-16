import type { AuthUser } from '../core/auth/auth-context.js';
import type { PromoInput, PromosService } from '../modules/promos/promos.service.js';
import {
  DEFAULT_PROMO,
  type PromoRules,
  type SettingsService,
} from '../modules/settings/settings.module.js';
import { normalizeCode } from './promo.js';

/**
 * The launch advertising campaign (docs/market-analysis.md §6.2-6.3, docs/store/ad-copy):
 * the public promo code the ads carry and the referral programme's settings. Applied by
 * `scripts/launch-campaign.ts` through the same services operators use in the panel, so it
 * is idempotent: a second run updates the code in place and rewrites the same settings.
 */

export interface LaunchCampaign {
  promo: PromoInput;
  /** The referral programme and ride credit rules (`invite_url` is set from the site). */
  referral: Omit<PromoRules, 'invite_url'>;
}

/** Tashkent is UTC+5 without DST: the last second of the day there. */
export const endOfTashkentDay = (date: string) => new Date(`${date}T23:59:59+05:00`);

export const LAUNCH_CAMPAIGN: LaunchCampaign = {
  promo: {
    code: 'GULISTON',
    kind: 'percent',
    value: 50,
    maxDiscount: 10_000,
    minFare: 0,
    validFrom: null,
    // the 0% driver commission promo ends the same day (DEFAULT_BILLING.promo_until)
    validUntil: endOfTashkentDay('2026-12-31'),
    usageLimit: null,
    perRiderLimit: 1,
    firstRideOnly: true,
    services: ['taxi'],
    classes: [],
    cityId: null,
    isActive: true,
    description: 'Ochilish aksiyasi: birinchi safarga 50% chegirma (10 000 so‘mgacha)',
    descriptionRu: 'Акция к открытию: скидка 50% на первую поездку (до 10 000 сум)',
  },
  referral: {
    referral_enabled: true,
    invitee_discount_percent: 50,
    invitee_max_discount: 10_000,
    invitee_rides: 1,
    referrer_bonus: 10_000,
    monthly_reward_cap: 10,
    credit_max_percent: 50,
    min_rider_pays: 1000,
  },
};

export interface CampaignResult {
  promo: { action: 'created' | 'updated'; id: string; code: string };
  settings: PromoRules;
}

/**
 * Creates the campaign's promo code or updates it to the campaign's definition when it
 * exists (found by its exact code), and writes the referral settings. `inviteUrl` is the
 * landing site's invitation page (https://taxi.<domain>/invite).
 */
export async function applyLaunchCampaign(
  deps: { promos: PromosService; settings: SettingsService; admin: AuthUser },
  campaign: LaunchCampaign = LAUNCH_CAMPAIGN,
  inviteUrl: string = DEFAULT_PROMO.invite_url,
): Promise<CampaignResult> {
  const code = normalizeCode(campaign.promo.code);
  const existing = (await deps.promos.adminList({ q: code })).find((p) => p.code === code);
  const promo = existing
    ? { action: 'updated' as const, ...(await deps.promos.update(existing.id, campaign.promo)) }
    : { action: 'created' as const, ...(await deps.promos.create(deps.admin, campaign.promo)) };
  const settings = await deps.settings.set('promo', {
    ...campaign.referral,
    invite_url: inviteUrl.replace(/\/+$/, ''),
  });
  return { promo: { action: promo.action, id: promo.id, code: promo.code }, settings };
}

/** The plan as a readable table for the console (what `--dry-run` prints). */
export function describeCampaign(campaign: LaunchCampaign, inviteUrl: string): string {
  const p = campaign.promo;
  const r = campaign.referral;
  const until = p.validUntil ? p.validUntil.toISOString() : 'no end';
  return [
    `Promo code ${p.code}: ${p.kind === 'percent' ? `${p.value}%` : `${p.value} so'm`}` +
      (p.maxDiscount ? ` up to ${p.maxDiscount} so'm` : '') +
      `, ${p.firstRideOnly ? 'first ride only' : 'any ride'}, ${p.perRiderLimit}x per rider` +
      `, services ${p.services.join(',') || 'all'}, until ${until}`,
    `Referral: ${r.referral_enabled ? 'on' : 'off'}; invitee ${r.invitee_discount_percent}% up to ` +
      `${r.invitee_max_discount} on ${r.invitee_rides} ride(s); referrer ${r.referrer_bonus} credit, ` +
      `${r.monthly_reward_cap || 'unlimited'} rewards/month; credit pays up to ${r.credit_max_percent}%, ` +
      `rider pays at least ${r.min_rider_pays}`,
    `Invite page: ${inviteUrl}/CODE`,
  ].join('\n');
}
