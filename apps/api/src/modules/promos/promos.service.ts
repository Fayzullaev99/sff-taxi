import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { randomInt } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { AuthUser } from '../../core/auth/auth-context.js';
import { BusinessCalendar } from '../../core/clock/business-calendar.js';
import { Database, type Tx } from '../../core/db/database.js';
import { containsPattern } from '../../core/db/like.js';
import type { PromoCodesTable, ReferralStatus, RidesTable } from '../../core/db/schema.js';
import { msg } from '../../core/http/messages.js';
import { emit } from '../../core/outbox/outbox.js';
import { type Limit, RateLimiter } from '../../core/redis/rate-limiter.js';
import { tashkentMonth } from '../../lib/commission.js';
import {
  checkPromo,
  CODE_PATTERN,
  inviteLinks,
  inviteText,
  makeReferralCode,
  normalizeCode,
  type PromoRule,
  promoDiscount,
  rewardAllowed,
  riderDiscount,
  soum,
  welcomeDiscount,
} from '../../lib/promo.js';
import { LedgerService } from '../billing/ledger.service.js';
import { type PromoRules, SettingsService } from '../settings/settings.module.js';

type Db = Tx | Database['kysely'];
type PromoRow = Selectable<PromoCodesTable>;
type Ride = Selectable<RidesTable>;

/** A promo code as operators write it (admin/promos). */
export interface PromoInput {
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  maxDiscount: number | null;
  minFare: number;
  validFrom: Date | null;
  validUntil: Date | null;
  usageLimit: number | null;
  perRiderLimit: number;
  firstRideOnly: boolean;
  services: string[];
  classes: string[];
  cityId: string | null;
  isActive: boolean;
  description: string | null;
}

/** What a discount is for: one class of a quote, or the ride being ordered. */
export interface DiscountTarget {
  cityId: string;
  service: string;
  rideClass: string;
  /** The fare before any rider discount. */
  fare: number;
}

/** The discount an order takes (reserve() checked and locked it). */
export interface DiscountPlan {
  promoId: string | null;
  referralId: string | null;
  promo: number;
  credit: number;
  total: number;
}

/** A ride's discount as the views show it. */
export interface RideDiscountView {
  promo: { id: string; source: 'code' | 'referral'; code: string; amount: number } | null;
  credit: number;
  total: number;
  status: 'reserved' | 'redeemed' | 'released';
}

/** Codes a rider may try per hour before a pause (guessing codes is not a game). */
const CODE_FAILURES_PER_HOUR = 10;

const toRule = (p: PromoRow): PromoRule => ({
  code: p.code,
  kind: p.kind,
  value: p.value,
  maxDiscount: p.max_discount,
  minFare: p.min_fare,
  validFrom: p.valid_from,
  validUntil: p.valid_until,
  usageLimit: p.usage_limit,
  perRiderLimit: p.per_rider_limit,
  firstRideOnly: p.first_ride_only,
  services: p.services,
  classes: p.classes,
  cityId: p.city_id,
  isActive: p.is_active,
});

/**
 * Rider discounts: promo codes (operators make them, riders save them), the referral
 * programme and ride credit. A discount is reserved when a ride is ordered (the code row is
 * locked while its uses are counted, so concurrent orders never overuse a limit), redeemed
 * when the ride completes and released when it is cancelled. The driver always earns the full
 * fare: a cash ride's discount is credited to the driver's balance (promo_compensation), a
 * card ride is charged the discounted amount and the full fare is credited (card_fare).
 */
@Injectable()
export class PromosService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly calendar: BusinessCalendar,
    private readonly limiter: RateLimiter,
  ) {}

  // Rider: the wallet ---------------------------------------------------------------------

  /**
   * Saved codes (usable or why not), ride credit, the rider's invitation and referral.
   * `deviceId`: the install showing it (remembered: a code entered from it later is the
   * referrer's own).
   */
  async wallet(userId: string, deviceId: string | null = null, now = new Date()) {
    if (deviceId) {
      await this.db.kysely
        .insertInto('referral_devices')
        .values({ user_id: userId, device_id: deviceId })
        .onConflict((oc) => oc.columns(['user_id', 'device_id']).doUpdateSet({ seen_at: now }))
        .execute();
    }
    const [rules, saved, balance, completed, code, invitedBy, invited] = await Promise.all([
      this.settings.promo(),
      this.db.kysely
        .selectFrom('rider_promos as rp')
        .innerJoin('promo_codes as p', 'p.id', 'rp.promo_id')
        .selectAll('p')
        .select('rp.added_at')
        .where('rp.user_id', '=', userId)
        .orderBy('rp.added_at', 'desc')
        .execute(),
      this.creditBalance(userId),
      this.completedRides(userId),
      this.referralCode(userId),
      this.db.kysely
        .selectFrom('referrals')
        .selectAll()
        .where('invitee_id', '=', userId)
        .executeTakeFirst(),
      this.db.kysely
        .selectFrom('referrals')
        .select([
          sql<number>`count(*)::int`.as('invited'),
          sql<number>`count(*) filter (where status = 'rewarded')::int`.as('rewarded'),
          sql<number>`coalesce(sum(reward_amount), 0)::int`.as('earned'),
        ])
        .where('referrer_id', '=', userId)
        .executeTakeFirstOrThrow(),
    ]);
    const uses = await this.uses(
      saved.map((p) => p.id),
      userId,
    );
    const links = inviteLinks(code, rules.invite_url);
    const welcomeLeft = invitedBy ? await this.welcomeRidesLeft(invitedBy, rules) : 0;
    return {
      promos: saved.map((p) => {
        const check = checkPromo(toRule(p), {
          now,
          totalUses: uses.get(p.id)?.total ?? 0,
          riderUses: uses.get(p.id)?.rider ?? 0,
          completedRides: completed,
          cityId: null,
        });
        return {
          ...this.publicPromo(p),
          usable: check.ok,
          reason: check.ok ? null : check.message,
          usesLeft: Math.max(0, p.per_rider_limit - (uses.get(p.id)?.rider ?? 0)),
          addedAt: p.added_at,
        };
      }),
      credit: { balance, maxPercent: rules.credit_max_percent },
      referral: {
        enabled: rules.referral_enabled,
        code,
        deepLink: links.deepLink,
        url: links.url,
        shareText: inviteText(code, links.url, rules),
        inviteeDiscountPercent: rules.invitee_discount_percent,
        inviteeMaxDiscount: rules.invitee_max_discount,
        inviteeRides: rules.invitee_rides,
        referrerBonus: rules.referrer_bonus,
        invited: invited.invited,
        rewarded: invited.rewarded,
        earned: invited.earned,
      },
      /** The invitation this rider accepted: the welcome discount left. */
      invitedBy: invitedBy
        ? {
            status: invitedBy.status,
            code: invitedBy.code,
            welcomeRidesLeft: welcomeLeft,
          }
        : null,
      /** A referral code can still be entered (before the first completed ride, once). */
      canEnterReferral: rules.referral_enabled && !invitedBy && completed === 0,
    };
  }

  /**
   * The rider enters a code (profile or order screen): a promo code is saved to the wallet
   * when the rider may use it at all; a friend's invitation code makes this rider an
   * invitee. Wrong codes count against an hourly budget.
   */
  async addCode(user: AuthUser, raw: string, deviceId: string | null = null) {
    const code = normalizeCode(raw);
    if (!CODE_PATTERN.test(code)) {
      throw new BadRequestException('Promokod 3–20 ta harf va raqamdan iborat bo‘ladi');
    }
    const limit = codeLimit(user.userId);
    await this.limiter.assertNotBlocked(limit);
    const promo = await this.db.kysely
      .selectFrom('promo_codes')
      .selectAll()
      .where('code', '=', code)
      .executeTakeFirst();
    if (promo) {
      const [uses, completed] = await Promise.all([
        this.uses([promo.id], user.userId),
        this.completedRides(user.userId),
      ]);
      const check = checkPromo(toRule(promo), {
        now: new Date(),
        totalUses: uses.get(promo.id)?.total ?? 0,
        riderUses: uses.get(promo.id)?.rider ?? 0,
        completedRides: completed,
        cityId: null,
      });
      if (!check.ok) {
        throw new ConflictException({ message: check.message, reason: check.reason });
      }
      await this.db.kysely
        .insertInto('rider_promos')
        .values({ user_id: user.userId, promo_id: promo.id })
        .onConflict((oc) => oc.columns(['user_id', 'promo_id']).doNothing())
        .execute();
      return { added: { kind: 'promo' as const, code }, wallet: await this.wallet(user.userId) };
    }
    const referral = await this.db.kysely
      .selectFrom('referral_codes')
      .select(['user_id', 'code'])
      .where('code', '=', code)
      .executeTakeFirst();
    if (!referral) {
      await this.limiter.recordFailure(limit);
      throw new NotFoundException({ message: 'Bunday promokod topilmadi', reason: 'not_found' });
    }
    await this.acceptReferral(user, referral, deviceId);
    return { added: { kind: 'referral' as const, code }, wallet: await this.wallet(user.userId) };
  }

  /** The rider takes a saved code off the wallet. */
  async removePromo(userId: string, promoId: string) {
    await this.db.kysely
      .deleteFrom('rider_promos')
      .where('user_id', '=', userId)
      .where('promo_id', '=', promoId)
      .execute();
    return this.wallet(userId);
  }

  /** Ride credit history, newest first. */
  async credits(userId: string, cursor?: string) {
    const [balance, rows] = await Promise.all([
      this.creditBalance(userId),
      this.db.kysely
        .selectFrom('rider_credits as c')
        .leftJoin('rides as r', 'r.id', 'c.ride_id')
        .select([
          'c.id',
          'c.kind',
          'c.amount',
          'c.ride_id as rideId',
          'r.number as rideNumber',
          'c.note',
          'c.created_at as createdAt',
        ])
        .where('c.user_id', '=', userId)
        .$if(Boolean(cursor), (q) => q.where('c.id', '<', cursor!))
        .orderBy('c.id', 'desc')
        .limit(50)
        .execute(),
    ]);
    return { balance, items: rows, nextCursor: rows.length === 50 ? rows.at(-1)!.id : null };
  }

  // Referrals ---------------------------------------------------------------------------

  /** The rider's personal invitation code, made on first use (unique among codes). */
  async referralCode(userId: string): Promise<string> {
    const existing = await this.db.kysely
      .selectFrom('referral_codes')
      .select('code')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (existing) return existing.code;
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = makeReferralCode(randomInt);
      // never the same as an operator's promo code: one input box takes both
      const clash = await this.db.kysely
        .selectFrom('promo_codes')
        .select('id')
        .where('code', '=', code)
        .executeTakeFirst();
      if (clash) continue;
      const inserted = await this.db.kysely
        .insertInto('referral_codes')
        .values({ user_id: userId, code })
        .onConflict((oc) => oc.doNothing())
        .returning('code')
        .executeTakeFirst();
      if (inserted) return inserted.code;
      // another request made this rider's code meanwhile, or the code is taken: read again
      const again = await this.db.kysely
        .selectFrom('referral_codes')
        .select('code')
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (again) return again.code;
    }
    throw new ConflictException('Qayta urinib ko‘ring');
  }

  /**
   * A new rider accepts a friend's invitation. Refused: the programme off, the rider's own
   * code, a rider who already completed a ride or accepted one before, a device that was
   * used for an invitation, or a device the referrer uses (self-referral from another SIM).
   */
  private async acceptReferral(
    user: AuthUser,
    referral: { user_id: string; code: string },
    deviceId: string | null,
  ) {
    const rules = await this.settings.promo();
    if (!rules.referral_enabled) {
      throw new BadRequestException('Taklif dasturi hozircha to‘xtatilgan');
    }
    if (referral.user_id === user.userId) {
      throw new BadRequestException('O‘zingizning taklif kodingizni kiritib bo‘lmaydi');
    }
    await this.db.transaction(async (trx) => {
      // the rider's lock (orders take it too): one referral, decided once
      await sql`select pg_advisory_xact_lock(hashtext(${user.userId}))`.execute(trx);
      const before = await trx
        .selectFrom('referrals')
        .select('id')
        .where('invitee_id', '=', user.userId)
        .executeTakeFirst();
      if (before) throw new ConflictException('Siz taklif kodini allaqachon kiritgansiz');
      if ((await this.completedRides(user.userId, trx)) > 0) {
        throw new ConflictException('Taklif kodi faqat birinchi safargacha kiritiladi');
      }
      const referrer = await trx
        .selectFrom('users')
        .select('status')
        .where('id', '=', referral.user_id)
        .executeTakeFirst();
      if (referrer?.status !== 'active') {
        throw new ConflictException('Bu taklif kodi amal qilmaydi');
      }
      if (deviceId) {
        const used = await trx
          .selectFrom('referrals')
          .select('id')
          .where('device_id', '=', deviceId)
          .executeTakeFirst();
        if (used) {
          throw new ConflictException('Bu qurilmadan taklif kodi allaqachon kiritilgan');
        }
        // the referrer opened the invitation on this very phone: one person, two SIM cards
        const referrers = await trx
          .selectFrom('referral_devices')
          .select('user_id')
          .where('device_id', '=', deviceId)
          .where('user_id', '=', referral.user_id)
          .executeTakeFirst();
        if (referrers) {
          throw new ConflictException('O‘z kodingizni boshqa raqamdan kiritib bo‘lmaydi');
        }
      }
      await trx
        .insertInto('referrals')
        .values({
          id: uuidv7(),
          referrer_id: referral.user_id,
          invitee_id: user.userId,
          code: referral.code,
          device_id: deviceId,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    });
  }

  /** How many welcome-discount rides the invitee has left (reserved ones count). */
  private async welcomeRidesLeft(
    r: { id: string; status: ReferralStatus },
    rules: PromoRules,
    db: Db = this.db.kysely,
  ): Promise<number> {
    if (r.status === 'revoked' || !rules.referral_enabled) return 0;
    const used = await db
      .selectFrom('ride_discounts')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('referral_id', '=', r.id)
      .where('status', '!=', 'released')
      .executeTakeFirstOrThrow();
    return Math.max(0, rules.invitee_rides - used.n);
  }

  // Quotes and orders -------------------------------------------------------------------

  /**
   * What each class of a quote would cost the rider: the best saved code (or the welcome
   * discount) and ride credit. Null when rider discounts do not apply (see `applies`).
   */
  async quoteDiscounts(
    userId: string,
    q: { cityId: string; service: string; fares: Record<string, number> },
    now = new Date(),
  ) {
    const rules = await this.settings.promo();
    const [candidates, balance] = await Promise.all([
      this.candidates(userId, q.cityId, now),
      this.creditBalance(userId),
    ]);
    if (!candidates.codes.length && !candidates.welcome && balance <= 0) {
      return { creditBalance: 0, classes: null, notes: candidates.notes };
    }
    const classes = Object.fromEntries(
      Object.entries(q.fares).map(([rideClass, fare]) => {
        const best = this.bestPromo(candidates, { ...q, rideClass, fare }, rules);
        const d = riderDiscount(fare, { promo: best.amount, creditBalance: balance }, rules);
        return [
          rideClass,
          {
            promo: best.choice && d.promo > 0 ? { ...best.choice, amount: d.promo } : null,
            /** Why the saved code does not apply to this class (min fare, class, service). */
            promoNote: best.choice ? null : best.note,
            credit: d.credit,
            total: d.total,
            fare,
            pays: d.pays,
          },
        ];
      }),
    );
    return { creditBalance: balance, classes, notes: candidates.notes };
  }

  /**
   * Checks and reserves the discount of a ride being ordered, inside the ordering
   * transaction (the caller holds the rider's advisory lock). The promo code's row (or the
   * referral's) is locked while its uses are counted: of two orders racing for the last use,
   * the second sees the first. `promoId` is what the quote offered (a code's id, or the
   * referral's for the welcome discount); a code that no longer applies is refused (409)
   * rather than silently dropped.
   */
  async reserve(
    trx: Tx,
    riderId: string,
    target: DiscountTarget,
    opts: { promoId: string | null; useCredit: boolean },
    now = new Date(),
  ): Promise<DiscountPlan | null> {
    if (!opts.promoId && !opts.useCredit) return null;
    const rules = await this.settings.promo(trx);
    let promo = 0;
    let promoId: string | null = null;
    let referralId: string | null = null;
    if (opts.promoId) {
      const code = await trx
        .selectFrom('promo_codes')
        .selectAll()
        .where('id', '=', opts.promoId)
        .forUpdate()
        .executeTakeFirst();
      if (code) {
        const saved = await trx
          .selectFrom('rider_promos')
          .select('promo_id')
          .where('user_id', '=', riderId)
          .where('promo_id', '=', code.id)
          .executeTakeFirst();
        if (!saved) throw new NotFoundException('Promokod topilmadi: uni qayta kiriting');
        const uses = await this.uses([code.id], riderId, trx);
        const check = checkPromo(toRule(code), {
          now,
          totalUses: uses.get(code.id)?.total ?? 0,
          riderUses: uses.get(code.id)?.rider ?? 0,
          completedRides: await this.completedRides(riderId, trx),
          cityId: target.cityId,
        });
        if (!check.ok) {
          throw new ConflictException({ message: check.message, reason: check.reason });
        }
        const d = promoDiscount(toRule(code), {
          total: target.fare,
          service: target.service,
          rideClass: target.rideClass,
        });
        if (!d.ok) throw new ConflictException({ message: d.message, reason: d.reason });
        promo = d.discount;
        promoId = code.id;
      } else {
        const referral = await trx
          .selectFrom('referrals')
          .selectAll()
          .where('id', '=', opts.promoId)
          .where('invitee_id', '=', riderId)
          .forUpdate()
          .executeTakeFirst();
        if (!referral) throw new NotFoundException('Promokod topilmadi: uni qayta kiriting');
        if ((await this.welcomeRidesLeft(referral, rules, trx)) <= 0) {
          throw new ConflictException({
            message: 'Taklif chegirmasi ishlatib bo‘lingan',
            reason: 'used',
          });
        }
        promo = welcomeDiscount(target.fare, rules);
        referralId = referral.id;
      }
    }
    const balance = opts.useCredit ? await this.creditBalance(riderId, trx) : 0;
    const d = riderDiscount(target.fare, { promo, creditBalance: balance }, rules);
    if (d.total <= 0) return null;
    return {
      promoId: d.promo > 0 ? promoId : null,
      referralId: d.promo > 0 ? referralId : null,
      promo: d.promo,
      credit: d.credit,
      total: d.total,
    };
  }

  /** Records the reserved discount on the new ride, in the ordering transaction. */
  async attach(trx: Tx, rideId: string, riderId: string, plan: DiscountPlan): Promise<void> {
    await trx
      .insertInto('ride_discounts')
      .values({
        ride_id: rideId,
        rider_id: riderId,
        promo_id: plan.promoId,
        referral_id: plan.referralId,
        promo_amount: plan.promo,
        credit_amount: plan.credit,
      })
      .execute();
    if (plan.credit > 0) {
      await trx
        .insertInto('rider_credits')
        .values({
          id: uuidv7(),
          user_id: riderId,
          kind: 'ride',
          amount: -plan.credit,
          ride_id: rideId,
          note: null,
        })
        .execute();
    }
    await trx
      .insertInto('ride_events')
      .values({
        id: uuidv7(),
        ride_id: rideId,
        type: 'discount_reserved',
        actor: 'system',
        actor_id: null,
        data: JSON.stringify({
          promo: plan.promo,
          credit: plan.credit,
          ...(plan.promoId ? { promoId: plan.promoId } : {}),
          ...(plan.referralId ? { referralId: plan.referralId } : {}),
        }),
      })
      .execute();
  }

  /** A ride's discount (0 when none or released). */
  async amountFor(rideId: string, db: Db = this.db.kysely): Promise<number> {
    const row = await db
      .selectFrom('ride_discounts')
      .select(['promo_amount', 'credit_amount'])
      .where('ride_id', '=', rideId)
      .where('status', '!=', 'released')
      .executeTakeFirst();
    return row ? row.promo_amount + row.credit_amount : 0;
  }

  /** Discounts of several rides at once (lists), not released ones. */
  async amountsFor(rideIds: string[]): Promise<Map<string, number>> {
    if (!rideIds.length) return new Map();
    const rows = await this.db.kysely
      .selectFrom('ride_discounts')
      .select(['ride_id', 'promo_amount', 'credit_amount'])
      .where('ride_id', 'in', rideIds)
      .where('status', '!=', 'released')
      .execute();
    return new Map(rows.map((r) => [r.ride_id, r.promo_amount + r.credit_amount]));
  }

  /** A ride's discount for its views (rider, driver, operator). */
  async view(rideId: string): Promise<RideDiscountView | null> {
    const row = await this.db.kysely
      .selectFrom('ride_discounts as d')
      .leftJoin('promo_codes as p', 'p.id', 'd.promo_id')
      .leftJoin('referrals as r', 'r.id', 'd.referral_id')
      .select([
        'd.promo_id',
        'd.referral_id',
        'd.promo_amount',
        'd.credit_amount',
        'd.status',
        'p.code as promo_code',
        'r.code as referral_code',
      ])
      .where('d.ride_id', '=', rideId)
      .executeTakeFirst();
    if (!row) return null;
    const promoRef = row.promo_id ?? row.referral_id;
    return {
      promo:
        promoRef && row.promo_amount > 0
          ? {
              id: promoRef,
              source: row.promo_id ? 'code' : 'referral',
              code: row.promo_code ?? row.referral_code ?? '',
              amount: row.promo_amount,
            }
          : null,
      credit: row.credit_amount,
      total: row.status === 'released' ? 0 : row.promo_amount + row.credit_amount,
      status: row.status,
    };
  }

  /**
   * The ride completed (its transaction, the ride locked): the discount is redeemed. The
   * rider handed the driver less cash, so the platform credits the difference to the driver's
   * balance (a card ride's full fare is credited as card_fare instead). Returns the discount.
   * Then the referral: the invitee's first completed ride rewards the referrer.
   */
  async onCompleted(
    trx: Tx,
    ride: Pick<Ride, 'id' | 'number' | 'rider_id' | 'driver_id' | 'payment_method'> & {
      /** The prepayment was refunded from the cabinet: the fare was taken in cash. */
      paidInCash: boolean;
    },
    now = new Date(),
  ): Promise<number> {
    const row = await trx
      .selectFrom('ride_discounts')
      .select(['promo_amount', 'credit_amount', 'status'])
      .where('ride_id', '=', ride.id)
      .forUpdate()
      .executeTakeFirst();
    let total = 0;
    if (row && row.status === 'reserved') {
      total = row.promo_amount + row.credit_amount;
      await trx
        .updateTable('ride_discounts')
        .set({ status: 'redeemed', redeemed_at: now })
        .where('ride_id', '=', ride.id)
        .execute();
      if (ride.paidInCash && ride.driver_id) {
        await this.ledger.post(trx, {
          driverId: ride.driver_id,
          kind: 'promo_compensation',
          amount: total,
          rideId: ride.id,
          note: `#${ride.number} yo‘lovchi chegirmasi (bonus kompensatsiya)`,
        });
      }
    }
    await this.rewardReferrer(trx, ride, now);
    return total;
  }

  /** The ride was cancelled: its discount is released and spent credit given back. */
  async onCancelled(trx: Tx, rideId: string, now = new Date()): Promise<void> {
    const row = await trx
      .selectFrom('ride_discounts')
      .select(['rider_id', 'credit_amount', 'status'])
      .where('ride_id', '=', rideId)
      .forUpdate()
      .executeTakeFirst();
    if (!row || row.status !== 'reserved') return;
    await trx
      .updateTable('ride_discounts')
      .set({ status: 'released', released_at: now })
      .where('ride_id', '=', rideId)
      .execute();
    if (row.credit_amount > 0) {
      await trx
        .insertInto('rider_credits')
        .values({
          id: uuidv7(),
          user_id: row.rider_id,
          kind: 'ride_release',
          amount: row.credit_amount,
          ride_id: rideId,
          note: 'Safar bekor qilindi: bonus qaytarildi',
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }

  /**
   * The invitee completed a ride: a pending referral rewards the referrer with ride credit,
   * unless the referrer already got this month's capped number of rewards ('capped').
   */
  private async rewardReferrer(trx: Tx, ride: Pick<Ride, 'id' | 'rider_id'>, now: Date) {
    const referral = await trx
      .selectFrom('referrals')
      .selectAll()
      .where('invitee_id', '=', ride.rider_id)
      .where('status', '=', 'pending')
      .forUpdate()
      .executeTakeFirst();
    if (!referral) return;
    const rules = await this.settings.promo(trx);
    // rewards of one referrer are counted one at a time (the monthly cap)
    await sql`select pg_advisory_xact_lock(hashtext(${'referrer:' + referral.referrer_id}))`.execute(
      trx,
    );
    const monthStart = this.calendar.real(
      new Date(`${tashkentMonth(this.calendar.at(now))}-01T00:00:00+05:00`),
    );
    const rewarded = await trx
      .selectFrom('referrals')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('referrer_id', '=', referral.referrer_id)
      .where('status', '=', 'rewarded')
      .where('rewarded_at', '>=', monthStart)
      .executeTakeFirstOrThrow();
    const allowed =
      rules.referral_enabled && rules.referrer_bonus > 0 && rewardAllowed(rewarded.n, rules);
    await trx
      .updateTable('referrals')
      .set({
        status: allowed ? 'rewarded' : 'capped',
        reward_amount: allowed ? rules.referrer_bonus : 0,
        reward_ride_id: ride.id,
        rewarded_at: now,
      })
      .where('id', '=', referral.id)
      .execute();
    if (!allowed) return;
    await trx
      .insertInto('rider_credits')
      .values({
        id: uuidv7(),
        user_id: referral.referrer_id,
        kind: 'referral_bonus',
        amount: rules.referrer_bonus,
        referral_id: referral.id,
        note: 'Do‘stingiz birinchi safarini yakunladi',
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await emit(trx, 'promo.referral_rewarded', {
      referralId: referral.id,
      referrerId: referral.referrer_id,
      amount: rules.referrer_bonus,
    });
  }

  // Operators ---------------------------------------------------------------------------

  /** Promo codes with their use: rides reserved and redeemed, the discount given. */
  async adminList(f: { q?: string; active?: boolean }) {
    const rows = await this.db.kysely
      .selectFrom('promo_codes as p')
      .selectAll('p')
      .select((eb) => [
        eb
          .selectFrom('ride_discounts as d')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('d.promo_id', '=', 'p.id')
          .where('d.status', '=', 'redeemed')
          .as('redeemed'),
        eb
          .selectFrom('ride_discounts as d')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('d.promo_id', '=', 'p.id')
          .where('d.status', '=', 'reserved')
          .as('reserved'),
        eb
          .selectFrom('ride_discounts as d')
          .select(sql<number>`coalesce(sum(d.promo_amount), 0)::int`.as('n'))
          .whereRef('d.promo_id', '=', 'p.id')
          .where('d.status', '=', 'redeemed')
          .as('discountTotal'),
        eb
          .selectFrom('rider_promos as rp')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('rp.promo_id', '=', 'p.id')
          .as('saved'),
      ])
      .$if(Boolean(f.q), (q) => q.where('p.code', 'like', containsPattern(normalizeCode(f.q!))))
      .$if(f.active !== undefined, (q) => q.where('p.is_active', '=', f.active!))
      .orderBy('p.created_at', 'desc')
      .limit(200)
      .execute();
    return rows.map((p) => ({
      ...this.adminPromo(p),
      stats: {
        redeemed: Number(p.redeemed ?? 0),
        reserved: Number(p.reserved ?? 0),
        discountTotal: Number(p.discountTotal ?? 0),
        saved: Number(p.saved ?? 0),
      },
    }));
  }

  /** One code with its statistics and the latest rides that used it. */
  async adminGet(id: string) {
    const list = await this.db.kysely
      .selectFrom('promo_codes')
      .select('code')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!list) throw new NotFoundException('Promokod topilmadi');
    const [promo] = (await this.adminList({ q: list.code })).filter((p) => p.id === id);
    const rides = await this.db.kysely
      .selectFrom('ride_discounts as d')
      .innerJoin('rides as r', 'r.id', 'd.ride_id')
      .select([
        'r.id as rideId',
        'r.number',
        'r.rider_phone as riderPhone',
        'r.class',
        'r.fare_quoted as fare',
        'r.payment_method as paymentMethod',
        'r.status as rideStatus',
        'd.promo_amount as discount',
        'd.status',
        'd.created_at as createdAt',
      ])
      .where('d.promo_id', '=', id)
      .orderBy('d.created_at', 'desc')
      .limit(100)
      .execute();
    return { ...promo!, rides };
  }

  async create(admin: AuthUser, input: PromoInput) {
    const code = await this.assertCodeFree(input.code);
    const id = uuidv7();
    // two operators saving the same code at once: the unique key decides
    const inserted = await this.db.kysely
      .insertInto('promo_codes')
      .values({
        id,
        ...this.columns(input),
        code,
        created_by: admin.userId,
        updated_at: new Date(),
      })
      .onConflict((oc) => oc.column('code').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) throw new ConflictException('Bunday promokod allaqachon bor');
    return this.adminGet(id);
  }

  async update(id: string, input: PromoInput) {
    const current = await this.db.kysely
      .selectFrom('promo_codes')
      .select('code')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!current) throw new NotFoundException('Promokod topilmadi');
    const code =
      normalizeCode(input.code) === current.code
        ? current.code
        : await this.assertCodeFree(input.code);
    try {
      await this.db.kysely
        .updateTable('promo_codes')
        .set({ ...this.columns(input), code, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Bunday promokod allaqachon bor');
      }
      throw e;
    }
    return this.adminGet(id);
  }

  /** Referrals for operators: who invited whom, the state, the reward. */
  async adminReferrals(f: { status?: ReferralStatus; q?: string; cursor?: string }) {
    const rows = await this.db.kysely
      .selectFrom('referrals as r')
      .innerJoin('users as a', 'a.id', 'r.referrer_id')
      .innerJoin('users as b', 'b.id', 'r.invitee_id')
      .select([
        'r.id',
        'r.code',
        'r.status',
        'r.reward_amount as rewardAmount',
        'r.reward_ride_id as rewardRideId',
        'r.rewarded_at as rewardedAt',
        'r.revoked_at as revokedAt',
        'r.revoke_note as revokeNote',
        'r.device_id as deviceId',
        'r.created_at as createdAt',
        'r.referrer_id as referrerId',
        'a.phone as referrerPhone',
        'a.full_name as referrerName',
        'r.invitee_id as inviteeId',
        'b.phone as inviteePhone',
        'b.full_name as inviteeName',
      ])
      .$if(Boolean(f.status), (q) => q.where('r.status', '=', f.status!))
      .$if(Boolean(f.q), (q) =>
        q.where((eb) =>
          eb.or([
            eb('a.phone', 'like', containsPattern(f.q!)),
            eb('b.phone', 'like', containsPattern(f.q!)),
            eb('r.code', '=', normalizeCode(f.q!)),
          ]),
        ),
      )
      .$if(Boolean(f.cursor), (q) => q.where('r.id', '<', f.cursor!))
      .orderBy('r.id', 'desc')
      .limit(100)
      .execute();
    return { items: rows, nextCursor: rows.length === 100 ? rows.at(-1)!.id : null };
  }

  /**
   * An operator revokes a referral (abuse): no welcome discount from now on, no reward; a
   * reward already given is taken back from the referrer's credit (as much as is left).
   */
  async revokeReferral(admin: AuthUser, id: string, note: string) {
    await this.db.transaction(async (trx) => {
      const r = await trx
        .selectFrom('referrals')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!r) throw new NotFoundException('Taklif topilmadi');
      if (r.status === 'revoked') throw new ConflictException('Taklif allaqachon bekor qilingan');
      await trx
        .updateTable('referrals')
        .set({
          status: 'revoked',
          revoked_at: new Date(),
          revoked_by: admin.userId,
          revoke_note: note,
        })
        .where('id', '=', id)
        .execute();
      if (r.status === 'rewarded' && r.reward_amount > 0) {
        // the referrer's credit is spent under the rider's lock (orders take it too)
        await sql`select pg_advisory_xact_lock(hashtext(${r.referrer_id}))`.execute(trx);
        const balance = await this.creditBalance(r.referrer_id, trx);
        const back = Math.min(balance, r.reward_amount);
        if (back > 0) {
          await trx
            .insertInto('rider_credits')
            .values({
              id: uuidv7(),
              user_id: r.referrer_id,
              kind: 'revoke',
              amount: -back,
              referral_id: r.id,
              note: `Taklif bonusi bekor qilindi: ${note}`.slice(0, 300),
              created_by: admin.userId,
            })
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
      }
    });
    return (await this.adminReferrals({ q: undefined })).items.find((x) => x.id === id) ?? null;
  }

  /** A rider's ride credit and referrals, for operators (complaints, abuse checks). */
  async adminRider(userId: string) {
    const [credits, asReferrer, asInvitee] = await Promise.all([
      this.credits(userId),
      this.db.kysely
        .selectFrom('referrals')
        .select(['id', 'invitee_id as inviteeId', 'status', 'reward_amount as rewardAmount'])
        .where('referrer_id', '=', userId)
        .orderBy('id', 'desc')
        .limit(50)
        .execute(),
      this.db.kysely
        .selectFrom('referrals')
        .select(['id', 'referrer_id as referrerId', 'status', 'code'])
        .where('invitee_id', '=', userId)
        .executeTakeFirst(),
    ]);
    return { credits, referrals: asReferrer, invitedBy: asInvitee ?? null };
  }

  // Helpers -----------------------------------------------------------------------------

  async creditBalance(userId: string, db: Db = this.db.kysely): Promise<number> {
    const row = await db
      .selectFrom('rider_credits')
      .select(sql<number>`coalesce(sum(amount), 0)::int`.as('balance'))
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    return row.balance;
  }

  private async completedRides(userId: string, db: Db = this.db.kysely): Promise<number> {
    const row = await db
      .selectFrom('rides')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('rider_id', '=', userId)
      .where('status', '=', 'completed')
      .executeTakeFirstOrThrow();
    return row.n;
  }

  /** Rides that reserved or redeemed each code: in total and by this rider. */
  private async uses(promoIds: string[], riderId: string, db: Db = this.db.kysely) {
    const map = new Map<string, { total: number; rider: number }>();
    if (!promoIds.length) return map;
    const rows = await db
      .selectFrom('ride_discounts')
      .select([
        'promo_id',
        sql<number>`count(*)::int`.as('total'),
        sql<number>`count(*) filter (where rider_id = ${riderId})::int`.as('rider'),
      ])
      .where('promo_id', 'in', promoIds)
      .where('status', '!=', 'released')
      .groupBy('promo_id')
      .execute();
    for (const r of rows) map.set(r.promo_id!, { total: r.total, rider: r.rider });
    return map;
  }

  /** The rider's saved codes usable in this city now, and the welcome discount if any. */
  private async candidates(userId: string, cityId: string, now: Date) {
    const [saved, completed, referral, rules] = await Promise.all([
      this.db.kysely
        .selectFrom('rider_promos as rp')
        .innerJoin('promo_codes as p', 'p.id', 'rp.promo_id')
        .selectAll('p')
        .where('rp.user_id', '=', userId)
        .execute(),
      this.completedRides(userId),
      this.db.kysely
        .selectFrom('referrals')
        .select(['id', 'status', 'code'])
        .where('invitee_id', '=', userId)
        .executeTakeFirst(),
      this.settings.promo(),
    ]);
    const uses = await this.uses(
      saved.map((p) => p.id),
      userId,
    );
    const notes: string[] = [];
    const codes = saved.filter((p) => {
      const check = checkPromo(toRule(p), {
        now,
        totalUses: uses.get(p.id)?.total ?? 0,
        riderUses: uses.get(p.id)?.rider ?? 0,
        completedRides: completed,
        cityId,
      });
      if (!check.ok && check.reason !== 'used') notes.push(`${p.code}: ${check.message}`);
      return check.ok;
    });
    const welcome =
      referral && (await this.welcomeRidesLeft(referral, rules)) > 0 ? referral : null;
    return { codes, welcome, notes };
  }

  /** The largest discount for one class among the candidates (and why none applies). */
  private bestPromo(
    c: Awaited<ReturnType<PromosService['candidates']>>,
    t: { service: string; rideClass: string; fare: number },
    rules: PromoRules,
  ) {
    let best: {
      choice: { id: string; source: 'code' | 'referral'; code: string; description: string | null };
      amount: number;
    } | null = null;
    let note: string | null = null;
    for (const p of c.codes) {
      const d = promoDiscount(toRule(p), {
        total: t.fare,
        service: t.service,
        rideClass: t.rideClass,
      });
      if (!d.ok) {
        note ??= d.message;
        continue;
      }
      if (!best || d.discount > best.amount) {
        best = {
          choice: { id: p.id, source: 'code', code: p.code, description: p.description },
          amount: d.discount,
        };
      }
    }
    if (c.welcome) {
      const amount = welcomeDiscount(t.fare, rules);
      if (amount > 0 && (!best || amount > best.amount)) {
        best = {
          choice: {
            id: c.welcome.id,
            source: 'referral',
            code: c.welcome.code,
            description: msg(
              'Do‘st taklifi: {0}% chegirma ({1}gacha)',
              rules.invitee_discount_percent,
              soum(rules.invitee_max_discount),
            ).message,
          },
          amount,
        };
      }
    }
    return best
      ? { choice: best.choice, amount: best.amount, note: null }
      : { choice: null, amount: 0, note };
  }

  /** A code must not be taken by another promo or by a rider's invitation code. */
  private async assertCodeFree(raw: string): Promise<string> {
    const code = normalizeCode(raw);
    if (!CODE_PATTERN.test(code)) {
      throw new BadRequestException('Kod 3–20 ta lotin harfi va raqamdan iborat bo‘ladi');
    }
    const [promo, referral] = await Promise.all([
      this.db.kysely
        .selectFrom('promo_codes')
        .select('id')
        .where('code', '=', code)
        .executeTakeFirst(),
      this.db.kysely
        .selectFrom('referral_codes')
        .select('user_id')
        .where('code', '=', code)
        .executeTakeFirst(),
    ]);
    if (promo) throw new ConflictException('Bunday promokod allaqachon bor');
    if (referral)
      throw new ConflictException('Bu kod yo‘lovchining taklif kodi: boshqasini tanlang');
    return code;
  }

  private columns(i: PromoInput) {
    return {
      kind: i.kind,
      value: i.value,
      max_discount: i.kind === 'percent' ? i.maxDiscount : null,
      min_fare: i.minFare,
      valid_from: i.validFrom,
      valid_until: i.validUntil,
      usage_limit: i.usageLimit,
      per_rider_limit: i.perRiderLimit,
      first_ride_only: i.firstRideOnly,
      services: [...new Set(i.services)],
      classes: [...new Set(i.classes)],
      city_id: i.cityId,
      is_active: i.isActive,
      description: i.description,
    };
  }

  /** What riders see of a code. */
  private publicPromo(p: PromoRow) {
    return {
      id: p.id,
      code: p.code,
      kind: p.kind,
      value: p.value,
      maxDiscount: p.max_discount,
      minFare: p.min_fare,
      validUntil: p.valid_until,
      firstRideOnly: p.first_ride_only,
      services: p.services,
      classes: p.classes,
      description: p.description,
    };
  }

  private adminPromo(p: PromoRow) {
    return {
      ...this.publicPromo(p),
      validFrom: p.valid_from,
      usageLimit: p.usage_limit,
      perRiderLimit: p.per_rider_limit,
      cityId: p.city_id,
      isActive: p.is_active,
      createdBy: p.created_by,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }
}

function codeLimit(userId: string): Limit {
  return {
    name: 'promo:code',
    subject: userId,
    max: CODE_FAILURES_PER_HOUR,
    windowSeconds: 3600,
    message: 'Noto‘g‘ri kod ko‘p marta kiritildi. Bir soatdan keyin qayta urinib ko‘ring',
  };
}
