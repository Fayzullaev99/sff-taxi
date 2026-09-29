import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuthUser } from '../../core/auth/auth-context.js';
import { Database, type Tx } from '../../core/db/database.js';
import { containsPattern } from '../../core/db/like.js';
import {
  ACTIVE_RIDE_STATUSES,
  DOCUMENT_KINDS,
  type DocumentKind,
  type DriverStatus,
  type DriversTable,
  type VehicleFeature,
  type VehiclesTable,
} from '../../core/db/schema.js';
import { emit } from '../../core/outbox/outbox.js';
import { type CargoClass, cargoClassOf, type VehicleBody } from '../../lib/cargo.js';
import {
  checkApplicant,
  checkVehicle,
  formatPlate,
  type RuleProblem,
  tashkentDate,
  type VehicleFacts,
} from '../../lib/driver-rules.js';
import { distanceM } from '../../lib/distance.js';
import { carCapacity, seatLayout } from '../../lib/pool.js';
import { priority } from '../../lib/priority.js';
import { DriverTrackService } from '../geo/driver-track.service.js';
import { PickupEtaService } from '../geo/pickup-eta.service.js';
import { RealtimeBus } from '../realtime/realtime.publisher.js';
import { LedgerService } from '../billing/ledger.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { recordLicenceCheck } from './licence-registry.js';

type Db = Tx | Database['kysely'];

export interface ApplicationInput {
  fullName: string;
  birthDate: string;
  pinfl: string;
  licenceNumber: string;
  licenceCategories: string[];
  licenceIssuedOn: string;
  licenceCardNumber: string;
  licenceCardExpiresOn: string;
  /** As in the passport; an operator verifies it (women riders may ask for a woman driver). */
  gender?: 'female' | 'male';
  vehicle: {
    make: string;
    model: string;
    colour: string;
    plate: string;
    year: number;
    seats: number;
    class: 'economy' | 'comfort';
    features: VehicleFeature[];
    cngInTrunk: boolean;
    /** taxi (Resolution 200) or cargo (a van, pickup or truck: cargo rides only). */
    service?: 'taxi' | 'cargo';
    body?: VehicleBody;
    payloadKg?: number | null;
    grossKg?: number | null;
  };
}

/** The driver's shared-ride and filter settings (PUT driver/preferences). */
export interface DriverPreferences {
  /** Takes riders who agreed to share while carrying someone. */
  poolEnabled?: boolean;
  /** People in the car without the app. */
  extraPassengers?: number;
  /** Where the driver is heading: offers only on the way; null clears it. */
  destination?: { lat: number; lng: number; address: string | null } | null;
  /** Verified women drivers: women riders only. */
  womenRidersOnly?: boolean;
}

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
}

/** Within this of the destination the driver's heading filter clears itself. */
export const DESTINATION_REACHED_M = 300;

const REJECTED_FIX = {
  inaccurate: 'Joylashuv aniqligi past',
  outside: 'Joylashuv xizmat hududidan juda uzoqda',
  too_fast: 'Joylashuv keskin o‘zgardi, qayta aniqlanmoqda',
} as const;

/** Operator decisions and the statuses they apply to. */
const TRANSITIONS = {
  approve: { from: ['pending'], to: 'active' },
  reject: { from: ['pending'], to: 'rejected' },
  block: { from: ['active', 'pending'], to: 'blocked' },
  unblock: { from: ['blocked'], to: 'active' },
} as const satisfies Record<string, { from: readonly DriverStatus[]; to: DriverStatus }>;
export type DriverDecision = keyof typeof TRANSITIONS;

function invalid(problems: RuleProblem[]): BadRequestException {
  return new BadRequestException({ message: problems[0]!.message, issues: problems });
}

/** Drivers: applications, verification by operators, shifts and GPS positions. */
@Injectable()
export class DriversService {
  constructor(
    private readonly db: Database,
    private readonly track: DriverTrackService,
    private readonly ledger: LedgerService,
    private readonly realtime: RealtimeBus,
    private readonly uploads: UploadsService,
    private readonly pickupEta: PickupEtaService,
  ) {}

  // Driver side ------------------------------------------------------------------------

  /**
   * Applies, or corrects an application that is pending or was rejected (it goes back to
   * the queue). Rule violations (age, experience, car age, van, seats) are refused with
   * every problem named.
   */
  async apply(user: AuthUser, input: ApplicationInput) {
    const today = tashkentDate(new Date());
    const problems = [
      ...checkApplicant(input, today),
      ...checkVehicle(input.vehicle, today, input.licenceCategories),
    ];
    if (problems.length) throw invalid(problems);

    await this.db.transaction(async (trx) => {
      const existing = await trx
        .selectFrom('drivers')
        .select(['status', 'licence_card_number', 'licence_status', 'gender'])
        .where('user_id', '=', user.userId)
        .forUpdate()
        .executeTakeFirst();
      // a new licence card (or a new driver) must be checked with the registry again
      const recheck = !existing || existing.licence_card_number !== input.licenceCardNumber;
      if (existing && existing.status !== 'pending' && existing.status !== 'rejected') {
        throw new ConflictException(
          'Arizangiz allaqachon ko‘rib chiqilgan: o‘zgartirish uchun operatorga murojaat qiling',
        );
      }
      const values = {
        full_name: input.fullName,
        birth_date: input.birthDate,
        pinfl: input.pinfl,
        licence_number: input.licenceNumber,
        licence_categories: input.licenceCategories,
        licence_issued_on: input.licenceIssuedOn,
        licence_card_number: input.licenceCardNumber,
        licence_card_expires_on: input.licenceCardExpiresOn,
        ...(input.gender && input.gender !== existing?.gender
          ? { gender: input.gender, gender_verified_at: null, gender_verified_by: null }
          : {}),
        status: 'pending' as const,
        status_reason: null,
        ...(recheck ? { licence_status: 'unverified' as const, licence_checked_at: null } : {}),
        updated_at: new Date(),
      };
      if (existing) {
        await trx.updateTable('drivers').set(values).where('user_id', '=', user.userId).execute();
        if (existing.status === 'rejected') {
          await this.logStatus(
            trx,
            user.userId,
            'rejected',
            'pending',
            'Ariza qayta yuborildi',
            user.userId,
          );
        }
      } else {
        await trx
          .insertInto('drivers')
          .values({ user_id: user.userId, ...values })
          .execute();
      }
      const v = input.vehicle;
      const cargo = v.service === 'cargo';
      const vehicle = {
        make: v.make,
        model: v.model,
        colour: v.colour,
        plate: v.plate,
        year: v.year,
        seats: v.seats,
        // a cargo car has no taxi class of its own (economy is the column's placeholder)
        class: cargo ? ('economy' as const) : v.class,
        features: [...new Set(v.features)],
        cng_in_trunk: v.cngInTrunk,
        body: v.body ?? (cargo ? 'van' : 'sedan'),
        payload_kg: v.payloadKg ?? null,
        gross_kg: v.grossKg ?? null,
        // the class follows the payload: up to 800 kg small, above medium
        cargo_class: cargo && v.payloadKg ? cargoClassOf(v.payloadKg) : null,
        updated_at: new Date(),
      };
      await trx
        .insertInto('vehicles')
        .values({ driver_id: user.userId, ...vehicle })
        .onConflict((oc) => oc.column('driver_id').doUpdateSet(vehicle))
        .execute();
      if (recheck) await emit(trx, 'driver.licence_check_requested', { driverId: user.userId });
      if (!user.fullName) {
        await trx
          .updateTable('users')
          .set({ full_name: input.fullName })
          .where('id', '=', user.userId)
          .execute();
      }
    });
    return this.me(user);
  }

  async setDocument(
    user: AuthUser,
    kind: DocumentKind,
    input: { uploadId?: string; url?: string; expiresOn: string | null },
  ) {
    await this.driverRow(user.userId);
    if (input.expiresOn && input.expiresOn < tashkentDate(new Date())) {
      throw new BadRequestException('Hujjat muddati o‘tgan');
    }
    if (input.uploadId) {
      // a photo of the car or a selfie may be the same file as the one riders see
      await this.uploads.requireAttachable(user.userId, input.uploadId, [
        'document',
        ...(kind === 'vehicle_photo' ? (['vehicle_photo'] as const) : []),
        ...(kind === 'selfie' ? (['profile_photo'] as const) : []),
      ]);
    }
    const values = {
      url: input.uploadId ? null : (input.url ?? null),
      upload_id: input.uploadId ?? null,
      expires_on: input.expiresOn,
      uploaded_at: new Date(),
    };
    await this.db.kysely
      .insertInto('driver_documents')
      .values({ driver_id: user.userId, kind, ...values })
      .onConflict((oc) => oc.columns(['driver_id', 'kind']).doUpdateSet(values))
      .execute();
    return this.me(user);
  }

  /** Sets the driver's photo or the car's photo that riders see. */
  async setPhoto(user: AuthUser, of: 'driver' | 'vehicle', uploadId: string) {
    await this.driverRow(user.userId);
    await this.uploads.requireAttachable(user.userId, uploadId, [
      of === 'driver' ? 'profile_photo' : 'vehicle_photo',
    ]);
    if (of === 'driver') {
      await this.db.kysely
        .updateTable('drivers')
        .set({ photo_upload_id: uploadId, updated_at: new Date() })
        .where('user_id', '=', user.userId)
        .execute();
    } else {
      const res = await this.db.kysely
        .updateTable('vehicles')
        .set({ photo_upload_id: uploadId, updated_at: new Date() })
        .where('driver_id', '=', user.userId)
        .executeTakeFirst();
      if (!res.numUpdatedRows) throw new NotFoundException('Avtomobil ma’lumotlari yo‘q');
    }
    return this.me(user);
  }

  /** The driver's own profile: status and reason, car, documents, score, balance. */
  async me(user: AuthUser) {
    const view = await this.view(user.userId);
    const standing = await this.ledger.standing(user.userId);
    return {
      ...view,
      balance: standing.balance,
      minBalance: standing.minBalance,
      blockers: this.blockers(view, standing.canWork),
    };
  }

  /** Starts or ends the shift. Starting needs an active, licensed driver with enough balance. */
  async setOnline(user: AuthUser, online: boolean) {
    await this.db.transaction(async (trx) => {
      const d = await trx
        .selectFrom('drivers')
        .selectAll()
        .where('user_id', '=', user.userId)
        .forUpdate()
        .executeTakeFirst();
      if (!d) throw new NotFoundException('Siz haydovchi sifatida ro‘yxatdan o‘tmagansiz');
      if (!online) {
        await trx
          .updateTable('drivers')
          .set({ is_online: false, online_since: null, updated_at: new Date() })
          .where('user_id', '=', user.userId)
          .execute();
        await this.withdrawOffers(trx, user.userId);
        return;
      }
      if (d.status !== 'active')
        throw new ForbiddenException(this.statusMessage(d.status, d.status_reason));
      if (d.licence_card_expires_on < tashkentDate(new Date())) {
        throw new ForbiddenException('Litsenziya kartochkasi muddati o‘tgan: yangisini yuklang');
      }
      if (d.licence_status !== 'valid') {
        throw new ForbiddenException(
          'Litsenziya kartochkasi tasdiqlanmagan: operatorga murojaat qiling',
        );
      }
      const standing = await this.ledger.standing(user.userId, trx);
      if (!standing.canWork) {
        throw new ForbiddenException({
          message: 'Balans juda past: liniyaga chiqish uchun balansni to‘ldiring',
          balance: standing.balance,
          minBalance: standing.minBalance,
        });
      }
      if (!d.is_online) {
        await trx
          .updateTable('drivers')
          .set({ is_online: true, online_since: new Date(), updated_at: new Date() })
          .where('user_id', '=', user.userId)
          .execute();
      }
    });
    return this.me(user);
  }

  /**
   * The driver's shared-ride settings: the mode, how many people ride without the app (they
   * need a destination: offers must be on their way) and the heading filter. The seating
   * rule counts the riders of the driver's active rides too.
   */
  async setPreferences(user: AuthUser, input: DriverPreferences) {
    await this.db.transaction(async (trx) => {
      const d = await trx
        .selectFrom('drivers as d')
        .leftJoin('vehicles as v', 'v.driver_id', 'd.user_id')
        .select([
          'd.status',
          'd.gender',
          'd.gender_verified_at',
          'd.extra_passengers',
          'd.destination',
          'd.pool_enabled',
          'v.seats',
        ])
        .where('d.user_id', '=', user.userId)
        .forUpdate('d')
        .executeTakeFirst();
      if (!d) throw new NotFoundException('Siz haydovchi sifatida ro‘yxatdan o‘tmagansiz');
      if (d.status !== 'active') throw new ForbiddenException('Hisobingiz faol emas');
      const extra = input.extraPassengers ?? d.extra_passengers;
      const destination = input.destination === undefined ? d.destination : input.destination;
      if (extra > 0 && !destination) {
        throw new BadRequestException(
          'Mashinada yo‘lovchi bo‘lsa, qayerga ketayotganingizni belgilang',
        );
      }
      if (input.womenRidersOnly && !(d.gender === 'female' && d.gender_verified_at)) {
        throw new ForbiddenException(
          'Bu imkoniyat jinsi operator tomonidan tasdiqlangan ayol haydovchilar uchun',
        );
      }
      const riders = await trx
        .selectFrom('rides')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('passengers'), eb.lit(0)).as('n'))
        .where('driver_id', '=', user.userId)
        .where('status', 'in', [...ACTIVE_RIDE_STATUSES])
        .executeTakeFirstOrThrow();
      const cap = carCapacity(d.seats ?? 4);
      if (Number(riders.n) + extra > cap) {
        throw new ConflictException(
          `Mashinada ${cap} tadan ortiq yo‘lovchi bo‘lmaydi (oldinda 1, orqada 2)`,
        );
      }
      await trx
        .updateTable('drivers')
        .set({
          ...(input.poolEnabled !== undefined ? { pool_enabled: input.poolEnabled } : {}),
          ...(input.womenRidersOnly !== undefined
            ? { women_riders_only: input.womenRidersOnly }
            : {}),
          extra_passengers: extra,
          ...(input.destination !== undefined
            ? input.destination
              ? {
                  destination: JSON.stringify({
                    lat: input.destination.lat,
                    lng: input.destination.lng,
                    address: input.destination.address,
                    landmark: null,
                  }),
                  destination_lat: input.destination.lat,
                  destination_lng: input.destination.lng,
                  destination_set_at: new Date(),
                }
              : {
                  destination: null,
                  destination_lat: null,
                  destination_lng: null,
                  destination_set_at: null,
                }
            : {}),
          updated_at: new Date(),
        })
        .where('user_id', '=', user.userId)
        .execute();
      // offers made under the old settings may no longer fit: they are withdrawn
      if (input.destination !== undefined || extra !== d.extra_passengers) {
        await this.withdrawOffers(trx, user.userId);
      }
    });
    return this.me(user);
  }

  /** An operator records the driver's gender as checked in the passport. */
  async verifyGender(operator: AuthUser, driverId: string, gender: 'female' | 'male') {
    const res = await this.db.kysely
      .updateTable('drivers')
      .set({
        gender,
        gender_verified_at: new Date(),
        gender_verified_by: operator.userId,
        // a man cannot keep the women-riders-only choice
        ...(gender === 'male' ? { women_riders_only: false } : {}),
        updated_at: new Date(),
      })
      .where('user_id', '=', driverId)
      .executeTakeFirst();
    if (!res.numUpdatedRows) throw new NotFoundException('Haydovchi topilmadi');
    return this.adminView(driverId);
  }

  /** A GPS fix from the driver app: implausible ones are refused, good ones kept with a trail. */
  async locate(user: AuthUser, fix: LocationFix): Promise<{ lat: number; lng: number; at: Date }> {
    const d = await this.driverRow(user.userId);
    if (d.status !== 'active')
      throw new ForbiddenException(this.statusMessage(d.status, d.status_reason));
    const now = new Date();
    const lastGood =
      d.lat !== null && d.lng !== null && d.located_at
        ? { lat: d.lat, lng: d.lng, at: d.located_at }
        : null;
    const verdict = await this.track.check(user.userId, { ...fix, at: now }, lastGood);
    if (!verdict.ok) {
      throw new UnprocessableEntityException({
        message: REJECTED_FIX[verdict.reason],
        reason: verdict.reason,
      });
    }
    await this.db.kysely
      .updateTable('drivers')
      .set({ lat: fix.lat, lng: fix.lng, heading: fix.heading ?? null, located_at: now })
      .where('user_id', '=', user.userId)
      .execute();
    await this.track.record(user.userId, {
      lat: fix.lat,
      lng: fix.lng,
      at: now,
      heading: fix.heading ?? null,
      speed: fix.speed ?? null,
    });
    // every rider of the driver's rides (several when they share the car) watches the car
    const rides = await this.db.kysely
      .selectFrom('rides')
      .select([
        'id',
        'rider_id',
        'status',
        'pickup_lat',
        'pickup_lng',
        'dropoff_lat',
        'dropoff_lng',
      ])
      .where('driver_id', '=', user.userId)
      .where('status', 'in', [...ACTIVE_RIDE_STATUSES])
      .execute();
    await Promise.all(
      rides.map(async (ride) => {
        // on the way to the pickup: the road ETA (one router call per ~15 s, cached)
        const eta =
          ride.status === 'driver_assigned'
            ? await this.pickupEta
                .eta(ride.id, fix, { lat: ride.pickup_lat, lng: ride.pickup_lng }, now)
                .catch(() => null)
            : null;
        // on the trip: the road ETA to the destination, refreshed the same way
        const toDestination =
          ride.status === 'in_progress'
            ? await this.pickupEta
                .eta(ride.id, fix, { lat: ride.dropoff_lat, lng: ride.dropoff_lng }, now, 'dropoff')
                .catch(() => null)
            : null;
        await this.realtime.publish({
          to: { userIds: [ride.rider_id] },
          event: {
            type: 'driver.location',
            rideId: ride.id,
            lat: fix.lat,
            lng: fix.lng,
            heading: fix.heading ?? null,
            at: now.toISOString(),
            etaS: eta?.etaS ?? null,
            destinationEtaS: toDestination?.etaS ?? null,
          },
        });
      }),
    );
    // a driver heading somewhere who got there (with nobody left to carry) is free again:
    // the filter clears itself, like Yandex's "Domoy"
    if (
      !rides.length &&
      d.destination_lat !== null &&
      d.destination_lng !== null &&
      distanceM(fix.lat, fix.lng, d.destination_lat, d.destination_lng) <= DESTINATION_REACHED_M
    ) {
      await this.db.kysely
        .updateTable('drivers')
        .set({
          destination: null,
          destination_lat: null,
          destination_lng: null,
          destination_set_at: null,
          extra_passengers: 0,
          updated_at: now,
        })
        .where('user_id', '=', user.userId)
        .execute();
      await this.realtime.publish({
        to: { userIds: [user.userId] },
        event: { type: 'driver.updated', driverId: user.userId, status: 'destination_reached' },
      });
    }
    return { lat: fix.lat, lng: fix.lng, at: now };
  }

  // Operators ----------------------------------------------------------------------------

  async list(filter: { status?: DriverStatus; q?: string }) {
    const rows = await this.db.kysely
      .selectFrom('drivers as d')
      .innerJoin('users as u', 'u.id', 'd.user_id')
      .leftJoin('vehicles as v', 'v.driver_id', 'd.user_id')
      .select([
        'd.user_id as id',
        'd.full_name as fullName',
        'u.phone',
        'd.status',
        'd.status_reason as statusReason',
        'd.is_online as isOnline',
        'd.created_at as createdAt',
        'v.plate',
        'v.make',
        'v.model',
        'v.class',
        'v.cargo_class as cargoClass',
        'v.body',
        'd.lat',
        'd.lng',
        'd.located_at as locatedAt',
        'd.offers_received',
        'd.offers_accepted',
        'd.rides_cancelled',
        'd.rating_sum',
        'd.rating_count',
        'd.rides_completed as ridesCompleted',
        'd.licence_status as licenceStatus',
        balanceOf('d.user_id').as('balance'),
        cardOwedOf('d.user_id').as('cardOwed'),
      ])
      .$if(Boolean(filter.status), (q) => q.where('d.status', '=', filter.status!))
      .$if(Boolean(filter.q), (q) =>
        q.where((eb) =>
          eb.or([
            eb('d.full_name', 'ilike', containsPattern(filter.q!)),
            eb('u.phone', 'like', containsPattern(filter.q!)),
            eb('v.plate', 'like', containsPattern(filter.q!.replace(/\s/g, '').toUpperCase())),
          ]),
        ),
      )
      .orderBy('d.created_at', 'desc')
      .limit(200)
      .execute();
    return rows.map(
      ({ offers_received, offers_accepted, rides_cancelled, rating_sum, rating_count, ...r }) => {
        const p = priority({
          offersReceived: offers_received,
          offersAccepted: offers_accepted,
          ridesCancelled: rides_cancelled,
          ratingSum: rating_sum,
          ratingCount: rating_count,
        });
        return {
          ...r,
          balance: Number(r.balance),
          // card fares credited minus payouts: what the platform still owes the driver
          cardOwed: Number(r.cardOwed),
          rating: p.stars,
          priority: p.score,
          plateFormatted: r.plate ? formatPlate(r.plate) : null,
        };
      },
    );
  }

  /** Everything an operator needs to verify a driver, with the status history. */
  async adminView(driverId: string) {
    const view = await this.view(driverId);
    const [history, standing, licenceChecks, cardMoney] = await Promise.all([
      this.db.kysely
        .selectFrom('driver_status_changes')
        .select([
          'from_status as from',
          'to_status as to',
          'reason',
          'actor_id as actorId',
          'created_at as at',
        ])
        .where('driver_id', '=', driverId)
        .orderBy('created_at', 'desc')
        .execute(),
      this.ledger.standing(driverId),
      this.db.kysely
        .selectFrom('licence_checks')
        .select([
          'source',
          'licence_card_number as licenceCardNumber',
          'result',
          'expires_on as expiresOn',
          'note',
          'checked_by as checkedBy',
          'created_at as at',
        ])
        .where('driver_id', '=', driverId)
        .orderBy('created_at', 'desc')
        .limit(20)
        .execute(),
      this.cardMoney(driverId),
    ]);
    return { ...view, history, licenceChecks, balance: standing.balance, cardMoney };
  }

  /**
   * Card money: fares riders prepaid by card, credited to the driver, minus payouts made.
   * `payableNow` is what can be paid out today (the balance also carries fees and debts).
   */
  async cardMoney(driverId: string) {
    const row = await this.db.kysely
      .selectFrom('driver_ledger')
      .select([
        sql<string>`coalesce(sum(amount) filter (where kind = 'card_fare'), 0)`.as('credited'),
        sql<string>`coalesce(-sum(amount) filter (where kind = 'payout'), 0)`.as('paidOut'),
        sql<string>`coalesce(sum(amount), 0)`.as('balance'),
        sql<Date | null>`max(created_at) filter (where kind = 'payout')`.as('lastPayoutAt'),
      ])
      .where('driver_id', '=', driverId)
      .executeTakeFirstOrThrow();
    return cardMoneyView(row);
  }

  /**
   * The payouts screen: drivers the platform owes card money to, most owed first, with what
   * can be paid out now (limited by the balance) and the last payout.
   */
  async payouts() {
    const rows = await this.db.kysely
      .selectFrom('driver_ledger as l')
      .innerJoin('drivers as d', 'd.user_id', 'l.driver_id')
      .innerJoin('users as u', 'u.id', 'l.driver_id')
      .select([
        'l.driver_id as driverId',
        'd.full_name as fullName',
        'u.phone',
        'd.status',
        sql<string>`coalesce(sum(l.amount) filter (where l.kind = 'card_fare'), 0)`.as('credited'),
        sql<string>`coalesce(-sum(l.amount) filter (where l.kind = 'payout'), 0)`.as('paidOut'),
        sql<string>`sum(l.amount)`.as('balance'),
        sql<Date | null>`max(l.created_at) filter (where l.kind = 'payout')`.as('lastPayoutAt'),
      ])
      .groupBy(['l.driver_id', 'd.full_name', 'u.phone', 'd.status'])
      .having(
        sql<boolean>`coalesce(sum(l.amount) filter (where l.kind in ('card_fare', 'payout')), 0) > 0`,
      )
      .execute();
    return rows
      .map(({ credited, paidOut, balance, lastPayoutAt, ...r }) => ({
        ...r,
        balance: Number(balance),
        ...cardMoneyView({ credited, paidOut, balance, lastPayoutAt }),
      }))
      .sort((a, b) => b.owed - a.owed);
  }

  /**
   * Approve / reject / block / unblock, each with a reason the driver sees. Approval
   * re-checks the rules and needs every document; blocking ends the shift.
   */
  async decide(admin: AuthUser, driverId: string, decision: DriverDecision, reason: string | null) {
    const rule = TRANSITIONS[decision];
    if (decision !== 'approve' && !reason) throw new BadRequestException('Sababini yozing');
    await this.db.transaction(async (trx) => {
      const d = await trx
        .selectFrom('drivers')
        .selectAll()
        .where('user_id', '=', driverId)
        .forUpdate()
        .executeTakeFirst();
      if (!d) throw new NotFoundException('Haydovchi topilmadi');
      if (!(rule.from as readonly string[]).includes(d.status)) {
        throw new ConflictException(`Bu amal "${d.status}" holatidagi haydovchiga qo‘llanmaydi`);
      }
      if (decision === 'approve') await this.assertApprovable(trx, d);
      await trx
        .updateTable('drivers')
        .set({
          status: rule.to,
          status_reason: decision === 'approve' || decision === 'unblock' ? null : reason,
          ...(decision === 'approve' ? { approved_at: new Date(), approved_by: admin.userId } : {}),
          ...(rule.to === 'blocked' ? { is_online: false, online_since: null } : {}),
          updated_at: new Date(),
        })
        .where('user_id', '=', driverId)
        .execute();
      await this.logStatus(trx, driverId, d.status, rule.to, reason, admin.userId);
      if (rule.to === 'blocked') await this.withdrawOffers(trx, driverId);
      await emit(trx, 'driver.status_changed', { driverId, from: d.status, to: rule.to, reason });
    });
    return this.adminView(driverId);
  }

  /** A driver going off shift (or blocked) stops holding up rides offered to them. */
  private async withdrawOffers(trx: Tx, driverId: string): Promise<void> {
    const withdrawn = await trx
      .updateTable('ride_offers')
      .set({ status: 'withdrawn', responded_at: new Date() })
      .where('driver_id', '=', driverId)
      .where('status', '=', 'pending')
      .returning(['id', 'ride_id'])
      .execute();
    for (const o of withdrawn) {
      await emit(trx, 'ride.offer_closed', {
        offerId: o.id,
        rideId: o.ride_id,
        driverId,
        status: 'withdrawn',
      });
    }
  }

  /** Operators may re-class a car or correct its features after an inspection. */
  async updateVehicle(
    driverId: string,
    input: {
      class?: 'economy' | 'comfort';
      features?: VehicleFeature[];
      cngInTrunk?: boolean;
      /** Cargo cars: the payload measured at the inspection, and the class it serves. */
      payloadKg?: number;
      cargoClass?: CargoClass;
    },
  ) {
    const v = await this.db.kysely
      .selectFrom('vehicles')
      .selectAll()
      .where('driver_id', '=', driverId)
      .executeTakeFirst();
    if (!v) throw new NotFoundException('Avtomobil topilmadi');
    if (!v.cargo_class && (input.payloadKg !== undefined || input.cargoClass !== undefined)) {
      throw new BadRequestException('Bu taksi avtomobili: yuk sinfi berilmaydi');
    }
    const next = {
      ...v,
      class: input.class ?? v.class,
      features: input.features ?? v.features,
      payload_kg: input.payloadKg ?? v.payload_kg,
      cargo_class: input.cargoClass ?? v.cargo_class,
    };
    const d = await this.db.kysely
      .selectFrom('drivers')
      .select('licence_categories')
      .where('user_id', '=', driverId)
      .executeTakeFirstOrThrow();
    const problems = checkVehicle(
      vehicleFacts(next),
      tashkentDate(new Date()),
      d.licence_categories,
    );
    if (problems.length) throw invalid(problems);
    await this.db.kysely
      .updateTable('vehicles')
      .set({
        class: next.class,
        features: [...new Set(next.features)],
        cng_in_trunk: input.cngInTrunk ?? v.cng_in_trunk,
        payload_kg: next.payload_kg,
        cargo_class: next.cargo_class,
        updated_at: new Date(),
      })
      .where('driver_id', '=', driverId)
      .execute();
    return this.adminView(driverId);
  }

  // Licence card ------------------------------------------------------------------------

  /** An operator's check of the licence card in the Ministry of Transport's registry. */
  async recordLicenceCheck(
    admin: AuthUser,
    driverId: string,
    input: { result: 'valid' | 'invalid'; note: string; expiresOn: string | null },
  ) {
    await this.db.transaction(async (trx) => {
      const d = await trx
        .selectFrom('drivers')
        .select(['licence_card_number'])
        .where('user_id', '=', driverId)
        .forUpdate()
        .executeTakeFirst();
      if (!d) throw new NotFoundException('Haydovchi topilmadi');
      await recordLicenceCheck(trx, {
        driverId,
        source: 'manual',
        licenceCardNumber: d.licence_card_number,
        verdict: { result: input.result, expiresOn: input.expiresOn, note: input.note, raw: null },
        checkedBy: admin.userId,
      });
      if (input.result === 'invalid') await this.withdrawOffers(trx, driverId);
    });
    return this.adminView(driverId);
  }

  // Appeals ----------------------------------------------------------------------------

  /** A rejected or blocked driver asks for a review; one open appeal at a time. */
  async appeal(user: AuthUser, text: string) {
    const d = await this.driverRow(user.userId);
    if (d.status !== 'rejected' && d.status !== 'blocked') {
      throw new ConflictException(
        'Faqat rad etilgan yoki bloklangan hisob uchun murojaat qilinadi',
      );
    }
    const id = uuidv7();
    await this.db.transaction(async (trx) => {
      const open = await trx
        .selectFrom('driver_appeals')
        .select('id')
        .where('driver_id', '=', user.userId)
        .where('status', '=', 'open')
        .executeTakeFirst();
      if (open) throw new ConflictException('Murojaatingiz ko‘rib chiqilmoqda');
      await trx
        .insertInto('driver_appeals')
        .values({ id, driver_id: user.userId, status_at: d.status as 'rejected' | 'blocked', text })
        .execute();
      await emit(trx, 'driver.appeal', { appealId: id, driverId: user.userId });
    });
    return (await this.appeals(user.userId))[0]!;
  }

  async appeals(driverId: string) {
    return this.db.kysely
      .selectFrom('driver_appeals')
      .select([
        'id',
        'status_at as statusAt',
        'text',
        'status',
        'resolution',
        'resolved_at as resolvedAt',
        'created_at as createdAt',
      ])
      .where('driver_id', '=', driverId)
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
  }

  async appealQueue(status: 'open' | 'resolved') {
    return this.db.kysely
      .selectFrom('driver_appeals as a')
      .innerJoin('drivers as d', 'd.user_id', 'a.driver_id')
      .innerJoin('users as u', 'u.id', 'a.driver_id')
      .select([
        'a.id',
        'a.driver_id as driverId',
        'd.full_name as fullName',
        'u.phone',
        'd.status as driverStatus',
        'd.status_reason as statusReason',
        'a.status_at as statusAt',
        'a.text',
        'a.status',
        'a.resolution',
        'a.resolved_by as resolvedBy',
        'a.resolved_at as resolvedAt',
        'a.created_at as createdAt',
      ])
      .where('a.status', '=', status)
      .orderBy('a.created_at', status === 'open' ? 'asc' : 'desc')
      .limit(200)
      .execute();
  }

  /** Answers an appeal; the driver hears at once (push and stream). */
  async resolveAppeal(admin: AuthUser, appealId: string, resolution: string) {
    const res = await this.db.transaction(async (trx) => {
      const row = await trx
        .updateTable('driver_appeals')
        .set({ status: 'resolved', resolution, resolved_by: admin.userId, resolved_at: new Date() })
        .where('id', '=', appealId)
        .where('status', '=', 'open')
        .returning('driver_id')
        .executeTakeFirst();
      if (!row) throw new NotFoundException('Ochiq murojaat topilmadi');
      await emit(trx, 'driver.appeal_resolved', { appealId, driverId: row.driver_id });
      return row;
    });
    return this.appeals(res.driver_id).then((all) => all.find((a) => a.id === appealId)!);
  }

  // Shared -----------------------------------------------------------------------------

  async driverRow(userId: string, db: Db = this.db.kysely): Promise<Selectable<DriversTable>> {
    const d = await db
      .selectFrom('drivers')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!d) throw new NotFoundException('Siz haydovchi sifatida ro‘yxatdan o‘tmagansiz');
    return d;
  }

  /** The driver as the apps and the panel show them. */
  async view(driverId: string) {
    const [d, v, docs, phone] = await Promise.all([
      this.db.kysely
        .selectFrom('drivers')
        .selectAll()
        .where('user_id', '=', driverId)
        .executeTakeFirst(),
      this.db.kysely
        .selectFrom('vehicles')
        .selectAll()
        .where('driver_id', '=', driverId)
        .executeTakeFirst(),
      this.db.kysely
        .selectFrom('driver_documents as doc')
        .leftJoin('uploads as up', 'up.id', 'doc.upload_id')
        .select([
          'doc.kind',
          'doc.url',
          'doc.upload_id',
          'up.content_type',
          'doc.expires_on as expiresOn',
          'doc.uploaded_at as uploadedAt',
        ])
        .where('doc.driver_id', '=', driverId)
        .orderBy('doc.kind')
        .execute(),
      this.db.kysely
        .selectFrom('users')
        .select('phone')
        .where('id', '=', driverId)
        .executeTakeFirst(),
    ]);
    if (!d) throw new NotFoundException('Haydovchi topilmadi');
    const have = new Set(docs.map((x) => x.kind));
    const urls = await this.uploads.readUrls([
      ...docs.map((x) => x.upload_id),
      d.photo_upload_id,
      v?.photo_upload_id ?? null,
    ]);
    const readUrl = (id: string | null) => (id ? (urls.get(id) ?? null) : null);
    return {
      id: d.user_id,
      fullName: d.full_name,
      phone: phone?.phone ?? null,
      birthDate: d.birth_date,
      pinfl: d.pinfl,
      licence: {
        number: d.licence_number,
        categories: d.licence_categories,
        issuedOn: d.licence_issued_on,
      },
      licenceCard: {
        number: d.licence_card_number,
        expiresOn: d.licence_card_expires_on,
        // unverified until an operator or the Ministry's registry checked it
        verification: d.licence_status,
        checkedAt: d.licence_checked_at,
      },
      status: d.status,
      statusReason: d.status_reason,
      approvedAt: d.approved_at,
      isOnline: d.is_online,
      onlineSince: d.online_since,
      location:
        d.lat !== null && d.lng !== null
          ? { lat: d.lat, lng: d.lng, heading: d.heading, at: d.located_at }
          : null,
      gender: d.gender,
      genderVerified: d.gender_verified_at !== null,
      womenRidersOnly: d.women_riders_only,
      // shared rides: the mode, people in the car without the app, the heading filter
      pool: {
        enabled: d.pool_enabled,
        extraPassengers: d.extra_passengers,
        destination: d.destination,
        destinationSetAt: d.destination_set_at,
        seats: seatLayout(d.extra_passengers, v?.seats ?? 4),
      },
      photoUrl: readUrl(d.photo_upload_id),
      vehicle: v ? { ...vehicleView(v), photoUrl: readUrl(v.photo_upload_id) } : null,
      documents: docs.map(({ upload_id, url, content_type, ...doc }) => ({
        ...doc,
        uploadId: upload_id,
        // image/jpeg, image/png, image/webp or application/pdf (a legacy URL: by its extension)
        contentType: content_type ?? typeFromUrl(url),
        // uploaded files: a short-lived read URL; old apps: the URL they sent
        url: upload_id ? readUrl(upload_id) : url,
      })),
      missingDocuments: DOCUMENT_KINDS.filter((k) => !have.has(k)),
      priority: priority({
        offersReceived: d.offers_received,
        offersAccepted: d.offers_accepted,
        ridesCancelled: d.rides_cancelled,
        ratingSum: d.rating_sum,
        ratingCount: d.rating_count,
      }),
      stats: {
        offersReceived: d.offers_received,
        offersAccepted: d.offers_accepted,
        ridesCompleted: d.rides_completed,
        ridesCancelled: d.rides_cancelled,
        ratingCount: d.rating_count,
      },
      createdAt: d.created_at,
    };
  }

  private blockers(view: Awaited<ReturnType<DriversService['view']>>, canWork: boolean): string[] {
    const out: string[] = [];
    if (view.status !== 'active') out.push(this.statusMessage(view.status, view.statusReason));
    if (view.missingDocuments.length) out.push('Hujjatlar to‘liq yuklanmagan');
    if (view.licenceCard.expiresOn < tashkentDate(new Date())) {
      out.push('Litsenziya kartochkasi muddati o‘tgan');
    }
    if (view.licenceCard.verification === 'unverified') {
      out.push('Litsenziya kartochkasi tekshirilmoqda');
    }
    if (view.licenceCard.verification === 'invalid') {
      out.push('Litsenziya kartochkasi tasdiqlanmadi');
    }
    if (!canWork) out.push('Balans juda past');
    return out;
  }

  private statusMessage(status: DriverStatus, reason: string | null): string {
    switch (status) {
      case 'pending':
        return 'Arizangiz operator tomonidan ko‘rib chiqilmoqda';
      case 'rejected':
        return reason ? `Ariza rad etildi: ${reason}` : 'Ariza rad etildi';
      case 'blocked':
        return reason ? `Hisobingiz bloklangan: ${reason}` : 'Hisobingiz bloklangan';
      default:
        return 'Faol';
    }
  }

  private async assertApprovable(trx: Tx, d: Selectable<DriversTable>): Promise<void> {
    const today = tashkentDate(new Date());
    const v = await trx
      .selectFrom('vehicles')
      .selectAll()
      .where('driver_id', '=', d.user_id)
      .executeTakeFirst();
    const problems: RuleProblem[] = [
      ...checkApplicant(
        {
          birthDate: d.birth_date,
          licenceIssuedOn: d.licence_issued_on,
          licenceCategories: d.licence_categories,
          licenceCardExpiresOn: d.licence_card_expires_on,
        },
        today,
      ),
      ...(v
        ? checkVehicle(vehicleFacts(v), today, d.licence_categories)
        : [{ path: 'vehicle', message: 'Avtomobil ma’lumotlari yo‘q' }]),
    ];
    const docs = await trx
      .selectFrom('driver_documents')
      .select(['kind', 'expires_on'])
      .where('driver_id', '=', d.user_id)
      .execute();
    const missing = DOCUMENT_KINDS.filter((k) => !docs.some((x) => x.kind === k));
    if (missing.length) {
      problems.push({ path: 'documents', message: `Hujjatlar yetishmaydi: ${missing.join(', ')}` });
    }
    for (const doc of docs) {
      if (doc.expires_on && doc.expires_on < today) {
        problems.push({
          path: `documents.${doc.kind}`,
          message: `Hujjat muddati o‘tgan: ${doc.kind}`,
        });
      }
    }
    if (d.licence_status !== 'valid') {
      problems.push({
        path: 'licenceCard',
        message:
          d.licence_status === 'invalid'
            ? 'Litsenziya kartochkasi reyestrda tasdiqlanmadi'
            : 'Litsenziya kartochkasini Transport vazirligi reyestrida tekshiring',
      });
    }
    if (problems.length) {
      throw new UnprocessableEntityException({ message: problems[0]!.message, issues: problems });
    }
  }

  private async logStatus(
    trx: Tx,
    driverId: string,
    from: string,
    to: string,
    reason: string | null,
    actorId: string | null,
  ): Promise<void> {
    await trx
      .insertInto('driver_status_changes')
      .values({
        id: uuidv7(),
        driver_id: driverId,
        from_status: from,
        to_status: to,
        reason,
        actor_id: actorId,
      })
      .execute();
  }
}

export function vehicleView(v: Selectable<VehiclesTable>) {
  return {
    make: v.make,
    model: v.model,
    colour: v.colour,
    plate: v.plate,
    plateFormatted: formatPlate(v.plate),
    year: v.year,
    seats: v.seats,
    class: v.class,
    features: v.features,
    cngInTrunk: v.cng_in_trunk,
    /** What luggage rides need: a big trunk without a gas tank in it. */
    luggage: v.features.includes('big_trunk') && !v.cng_in_trunk,
    /** taxi: passenger rides and deliveries; cargo: cargo rides of its class only. */
    service: v.cargo_class ? ('cargo' as const) : ('taxi' as const),
    body: v.body,
    payloadKg: v.payload_kg,
    grossKg: v.gross_kg,
    cargoClass: v.cargo_class,
  };
}

/** The rules' view of a stored car: a car with a cargo class follows the cargo rules. */
export function vehicleFacts(v: Selectable<VehiclesTable>): VehicleFacts {
  return {
    make: v.make,
    model: v.model,
    year: v.year,
    seats: v.seats,
    class: v.class,
    features: v.features,
    service: v.cargo_class ? 'cargo' : 'taxi',
    body: v.body,
    payloadKg: v.payload_kg,
    grossKg: v.gross_kg,
  };
}

/** A legacy document URL's type by its extension (null when it does not say). */
export function typeFromUrl(url: string | null): string | null {
  const ext = url?.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return null;
}

/** Card money from ledger sums (strings from Postgres). */
function cardMoneyView(r: {
  credited: string;
  paidOut: string;
  balance: string;
  lastPayoutAt: Date | null;
}) {
  const credited = Number(r.credited);
  const paidOut = Number(r.paidOut);
  const owed = credited - paidOut;
  return {
    credited,
    paidOut,
    owed,
    /** A payout is refused above the balance: fees and debts are settled first. */
    payableNow: Math.max(0, Math.min(owed, Number(r.balance))),
    lastPayoutAt: r.lastPayoutAt,
  };
}

/** SQL: card fares credited minus payouts made (what the platform owes the driver). */
export const cardOwedOf = (driverIdRef: string) =>
  sql<number>`(select coalesce(sum(l.amount), 0) from driver_ledger l where l.driver_id = ${sql.ref(driverIdRef)} and l.kind in ('card_fare', 'payout'))`;

/** SQL: whether a driver's balance still allows work (used by dispatch). */
export const balanceOf = (driverIdRef: string) =>
  sql<number>`(select coalesce(sum(l.amount), 0) from driver_ledger l where l.driver_id = ${sql.ref(driverIdRef)})`;
