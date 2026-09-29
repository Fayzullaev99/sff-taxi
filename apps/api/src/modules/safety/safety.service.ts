import { driverGivenName } from '../../lib/names.js';
import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { AuthUser } from '../../core/auth/auth-context.js';
import { Database } from '../../core/db/database.js';
import { OPEN_RIDE_STATUSES } from '../../core/db/schema.js';
import { emit } from '../../core/outbox/outbox.js';
import { formatPlate } from '../../lib/driver-rules.js';
import { DriverTrackService } from '../geo/driver-track.service.js';
import { RidesService } from '../rides/rides.service.js';

/** A rating may be left this long after the ride. */
const RATING_WINDOW_DAYS = 7;
/** SOS still works this long after a ride ended (something happened right after it). */
const SOS_AFTER_RIDE_MINUTES = 60;

/** Emergency numbers in Uzbekistan, shown with every SOS answer. */
export const EMERGENCY_NUMBERS = { unified: '112', police: '102', ambulance: '103', fire: '101' };

export interface RatingInput {
  stars: number;
  tags: string[];
  comment: string | null;
}

/** Trust and safety: ratings both ways, SOS alerts, share-trip links. */
@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    private readonly db: Database,
    private readonly rides: RidesService,
    private readonly track: DriverTrackService,
  ) {}

  /** Rider rates the driver, or driver rates the rider: once per side per completed ride. */
  async rate(user: AuthUser, rideId: string, role: 'rider' | 'driver', input: RatingInput) {
    await this.db.transaction(async (trx) => {
      const ride = await this.rides.lockRide(trx, rideId);
      const mine =
        role === 'rider' ? ride.rider_id === user.userId : ride.driver_id === user.userId;
      if (!mine) throw new NotFoundException('Buyurtma topilmadi');
      if (ride.status !== 'completed' || !ride.completed_at) {
        throw new ConflictException('Faqat yakunlangan safarni baholash mumkin');
      }
      if (Date.now() - ride.completed_at.getTime() > RATING_WINDOW_DAYS * 86_400_000) {
        throw new GoneException('Baholash muddati o‘tgan');
      }
      const subjectId = role === 'rider' ? ride.driver_id! : ride.rider_id;
      const inserted = await trx
        .insertInto('ratings')
        .values({
          id: uuidv7(),
          ride_id: ride.id,
          author_role: role,
          author_id: user.userId,
          subject_id: subjectId,
          stars: input.stars,
          tags: [...new Set(input.tags)],
          comment: input.comment,
        })
        .onConflict((oc) => oc.columns(['ride_id', 'author_role']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!inserted) throw new ConflictException('Siz bu safarni allaqachon baholagansiz');
      if (role === 'rider') {
        await trx
          .updateTable('drivers')
          .set((eb) => ({
            rating_sum: eb('rating_sum', '+', input.stars),
            rating_count: eb('rating_count', '+', 1),
          }))
          .where('user_id', '=', subjectId)
          .execute();
      } else {
        await trx
          .updateTable('users')
          .set((eb) => ({
            rider_rating_sum: eb('rider_rating_sum', '+', input.stars),
            rider_rating_count: eb('rider_rating_count', '+', 1),
          }))
          .where('id', '=', subjectId)
          .execute();
      }
      await this.rides.event(trx, ride.id, 'rated', role, user.userId, { stars: input.stars });
    });
    return { rideId, role, stars: input.stars };
  }

  /**
   * SOS from the rider or the driver of a ride: logged with the position, and operators are
   * alerted at once (realtime + push). The answer carries the emergency numbers to call.
   */
  async sos(
    user: AuthUser,
    rideId: string,
    role: 'rider' | 'driver',
    input: { lat: number | null; lng: number | null; note: string | null },
  ) {
    const id = uuidv7();
    await this.db.transaction(async (trx) => {
      const ride = await this.rides.findRide(rideId, trx);
      const mine =
        role === 'rider' ? ride.rider_id === user.userId : ride.driver_id === user.userId;
      if (!mine) throw new NotFoundException('Buyurtma topilmadi');
      const ended = ride.completed_at ?? ride.cancelled_at;
      const open = (OPEN_RIDE_STATUSES as readonly string[]).includes(ride.status);
      if (!open && (!ended || Date.now() - ended.getTime() > SOS_AFTER_RIDE_MINUTES * 60_000)) {
        throw new GoneException('Safar allaqachon yakunlangan: 112 raqamiga qo‘ng‘iroq qiling');
      }
      await trx
        .insertInto('sos_events')
        .values({
          id,
          ride_id: ride.id,
          user_id: user.userId,
          role,
          lat: input.lat,
          lng: input.lng,
          note: input.note,
        })
        .execute();
      await this.rides.event(trx, ride.id, 'sos', role, user.userId, {
        sosId: id,
        lat: input.lat,
        lng: input.lng,
      });
      await emit(trx, 'ride.sos', { sosId: id, rideId: ride.id });
      await emit(trx, 'ride.attention', { rideId: ride.id, reason: 'sos' });
    });
    this.logger.warn(`SOS ${id} from the ${role} of ride ${rideId}`);
    return { id, emergency: EMERGENCY_NUMBERS };
  }

  async sosList(open: boolean) {
    return this.db.kysely
      .selectFrom('sos_events as s')
      .innerJoin('rides as r', 'r.id', 's.ride_id')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select([
        's.id',
        's.ride_id as rideId',
        'r.number as rideNumber',
        'r.status as rideStatus',
        'r.driver_id as driverId',
        's.role',
        'u.phone',
        's.lat',
        's.lng',
        's.note',
        's.created_at as createdAt',
        's.resolved_at as resolvedAt',
        's.resolution_note as resolutionNote',
      ])
      .$if(open, (q) => q.where('s.resolved_at', 'is', null))
      .orderBy('s.created_at', 'desc')
      .limit(200)
      .execute();
  }

  async resolveSos(operator: AuthUser, sosId: string, note: string) {
    const res = await this.db.kysely
      .updateTable('sos_events')
      .set({ resolved_at: new Date(), resolved_by: operator.userId, resolution_note: note })
      .where('id', '=', sosId)
      .where('resolved_at', 'is', null)
      .executeTakeFirst();
    if (!res.numUpdatedRows) throw new NotFoundException('Ochiq SOS topilmadi');
    return { id: sosId, resolved: true };
  }

  /**
   * What a share-trip link shows (no login): the car, the driver's first name and the live
   * position with a short trail. No phone numbers. The link dies when the ride ends.
   */
  async shared(token: string) {
    const ride = await this.db.kysely
      .selectFrom('rides')
      .selectAll()
      .where('share_token', '=', token)
      .executeTakeFirst();
    if (!ride) throw new NotFoundException('Havola topilmadi');
    if (!(OPEN_RIDE_STATUSES as readonly string[]).includes(ride.status)) {
      throw new GoneException('Safar yakunlangan');
    }
    const driver = ride.driver_id ? await this.rides.driverCard(ride.driver_id) : null;
    const trail =
      ride.driver_id && ride.assigned_at
        ? await this.track.trail(ride.driver_id, ride.assigned_at)
        : [];
    return {
      number: ride.number,
      status: ride.status,
      pickup: { ...ride.pickup, lat: ride.pickup_lat, lng: ride.pickup_lng },
      dropoff: { ...ride.dropoff, lat: ride.dropoff_lat, lng: ride.dropoff_lng },
      driver: driver ? { name: driverGivenName(driver.name), rating: driver.rating } : null,
      vehicle: ride.vehicle
        ? {
            make: ride.vehicle.make,
            model: ride.vehicle.model,
            colour: ride.vehicle.colour,
            plateFormatted: formatPlate(ride.vehicle.plate),
          }
        : null,
      position: driver?.location ?? null,
      trail,
      startedAt: ride.started_at,
    };
  }
}
