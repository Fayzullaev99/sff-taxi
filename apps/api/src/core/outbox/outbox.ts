import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../db/database.js';

/** Events other parts of the system react to after the change has committed. */
export type OutboxTopic =
  /** A new ride waits for a driver: the dispatcher looks for one at once. { rideId } */
  | 'ride.requested'
  /** { rideId, from, to, previousDriverId? } */
  | 'ride.status_changed'
  /** A driver got an offer (direct or broadcast). { offerId, rideId, driverId } */
  | 'ride.offer_created'
  /** An offer was declined, expired or withdrawn. { offerId, rideId, driverId, status } */
  | 'ride.offer_closed'
  /** Operators must act: nobody took the ride, ... { rideId, reason } */
  | 'ride.attention'
  /** { sosId, rideId } */
  | 'ride.sos'
  /** A driver was approved, rejected, blocked or unblocked. { driverId, from, to, reason } */
  | 'driver.status_changed'
  /** A rejected or blocked driver asked for a review. { appealId, driverId } */
  | 'driver.appeal';

/**
 * Records an event in the caller's transaction: it is delivered by the worker
 * if and only if the change it describes commits.
 */
export async function emit(trx: Tx, topic: OutboxTopic, payload: Record<string, unknown>) {
  await trx
    .insertInto('outbox')
    .values({ id: uuidv7(), topic, payload: JSON.stringify(payload) })
    .execute();
}
