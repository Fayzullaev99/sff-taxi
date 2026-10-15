/** Rider discounts as the panel sees them (admin/promos, admin/referrals, settings/promo). */

export type PromoKind = 'percent' | 'fixed';

export interface PromoStats {
  /** Completed rides that used the code. */
  redeemed: number;
  /** Open rides holding a use of it (released if cancelled). */
  reserved: number;
  /** So'm given on completed rides (the platform's cost). */
  discountTotal: number;
  /** Riders who saved it. */
  saved: number;
}

export interface AdminPromo {
  id: string;
  code: string;
  kind: PromoKind;
  value: number;
  maxDiscount: number | null;
  minFare: number;
  validFrom: string | null;
  validUntil: string | null;
  usageLimit: number | null;
  perRiderLimit: number;
  firstRideOnly: boolean;
  services: string[];
  classes: string[];
  cityId: string | null;
  isActive: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  stats: PromoStats;
}

export interface PromoRide {
  rideId: string;
  number: number;
  riderPhone: string;
  class: string;
  fare: number;
  paymentMethod: 'cash' | 'card';
  rideStatus: string;
  discount: number;
  status: 'reserved' | 'redeemed' | 'released';
  createdAt: string;
}

export interface AdminPromoDetail extends AdminPromo {
  rides: PromoRide[];
}

/** POST / PATCH admin/promos. */
export interface PromoBody {
  code: string;
  kind: PromoKind;
  value: number;
  maxDiscount: number | null;
  minFare: number;
  validFrom: string | null;
  validUntil: string | null;
  usageLimit: number | null;
  perRiderLimit: number;
  firstRideOnly: boolean;
  services: string[];
  classes: string[];
  cityId: string | null;
  isActive: boolean;
  description: string | null;
}

export type ReferralStatus = 'pending' | 'rewarded' | 'capped' | 'revoked';

export interface Referral {
  id: string;
  code: string;
  status: ReferralStatus;
  rewardAmount: number;
  rewardRideId: string | null;
  rewardedAt: string | null;
  revokedAt: string | null;
  revokeNote: string | null;
  deviceId: string | null;
  createdAt: string;
  referrerId: string;
  referrerPhone: string;
  referrerName: string | null;
  inviteeId: string;
  inviteePhone: string;
  inviteeName: string | null;
}

/** admin/settings/promo. */
export interface PromoRules {
  referral_enabled: boolean;
  invitee_discount_percent: number;
  invitee_max_discount: number;
  invitee_rides: number;
  referrer_bonus: number;
  monthly_reward_cap: number;
  credit_max_percent: number;
  min_rider_pays: number;
  invite_url: string;
}

/** A ride's rider discount (admin ride view). */
export interface RideDiscount {
  promo: { id: string; source: 'code' | 'referral'; code: string; amount: number } | null;
  credit: number;
  total: number;
  status: 'reserved' | 'redeemed' | 'released';
}
