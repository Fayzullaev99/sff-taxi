/** Rider discounts: promo codes, the invitation ("Do'stni taklif qil") and ride credit. */

export interface SavedPromo {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  maxDiscount: number | null;
  minFare: number;
  validUntil: string | null;
  firstRideOnly: boolean;
  services: string[];
  classes: string[];
  description: string | null;
  /** The rider may use it now (in some city/class); else `reason` says why not. */
  usable: boolean;
  reason: string | null;
  usesLeft: number;
  addedAt: string;
}

export interface ReferralCard {
  enabled: boolean;
  code: string;
  /** sfftaxi://invite/CODE: opens the app on phones that have it. */
  deepLink: string;
  /** The web page for phones without the app. */
  url: string;
  shareText: string;
  inviteeDiscountPercent: number;
  inviteeMaxDiscount: number;
  inviteeRides: number;
  referrerBonus: number;
  invited: number;
  rewarded: number;
  earned: number;
}

/** GET /promos */
export interface PromoWallet {
  promos: SavedPromo[];
  credit: { balance: number; maxPercent: number };
  referral: ReferralCard;
  invitedBy: {
    status: 'pending' | 'rewarded' | 'capped' | 'revoked';
    code: string;
    welcomeRidesLeft: number;
  } | null;
  canEnterReferral: boolean;
}

/** POST /promos */
export interface AddedCode {
  added: { kind: 'promo' | 'referral'; code: string };
  wallet: PromoWallet;
}

export interface CreditEntry {
  id: string;
  kind: 'referral_bonus' | 'ride' | 'ride_release' | 'revoke' | 'adjustment';
  amount: number;
  rideId: string | null;
  rideNumber: number | null;
  note: string | null;
  createdAt: string;
}

export interface CreditsPage {
  balance: number;
  items: CreditEntry[];
  nextCursor: string | null;
}

/** The discount a quote offers on one class. */
export interface ClassDiscount {
  /** The best saved code (or the invitation's welcome discount); null when none applies. */
  promo: {
    id: string;
    source: 'code' | 'referral';
    code: string;
    description: string | null;
    amount: number;
  } | null;
  /** Why the saved code does not apply to this class (class, service, minimum fare). */
  promoNote: string | null;
  /** Ride credit the order would spend. */
  credit: number;
  total: number;
  fare: number;
  pays: number;
}

/** The quote's `discounts`: null for rides for later; `classes` null without any discount. */
export interface QuoteDiscounts {
  creditBalance: number;
  classes: Record<string, ClassDiscount> | null;
  /** Saved codes that do not apply here (another city, expired…), "CODE: why". */
  notes: string[];
}

/** A ride's discount as the ride view shows it (on `fare`). */
export interface FareDiscount {
  /** promo + credit; 0 when none (or released by a cancellation). */
  discount?: number;
  promo?: { id: string; source: 'code' | 'referral'; code: string; amount: number } | null;
  credit?: number;
  /** What the rider paid in all once completed (the fare total less the discount). */
  riderTotal?: number | null;
}
