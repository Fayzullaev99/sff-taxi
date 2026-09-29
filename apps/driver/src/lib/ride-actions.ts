import { isApiError } from './api-client';
import { backoffMs, sleep } from './backoff';
import type { RideAction } from './ride-flow';

/**
 * Accepting an offer and the ride steps (arrive / start / complete) on a patchy network.
 * The API's steps are not idempotent: a retry after a lost answer gets `409 Buyurtma
 * holati mos emas` (the step already happened) and a second accept gets `409 Taklif endi
 * amal qilmaydi`. So a request that got no answer is sent again (the same request), and
 * a 409 is checked against the ride itself before it is shown as a failure.
 */

/** Ride statuses in the order a ride moves through them. */
const ORDER = ['driver_assigned', 'driver_arrived', 'in_progress', 'completed'] as const;

/** The status each step leads to. */
export const STEP_TARGET: Record<RideAction, (typeof ORDER)[number]> = {
  arrive: 'driver_arrived',
  start: 'in_progress',
  complete: 'completed',
};

/** Whether a ride in `status` is already at or past what `action` leads to. */
export function stepReached(status: string | null | undefined, action: RideAction): boolean {
  const at = ORDER.indexOf(status as (typeof ORDER)[number]);
  return at !== -1 && at >= ORDER.indexOf(STEP_TARGET[action]);
}

/**
 * The status to show while `action` is on its way (optimistic): the target, unless the
 * ride is already further. Undone by itself when the request fails (nothing is written
 * to the cache).
 */
export function optimisticStatus(status: string, action: RideAction | null | undefined): string {
  if (!action || stepReached(status, action)) return status;
  return STEP_TARGET[action];
}

/** No answer at all (0) or the server is struggling: worth sending the same request again. */
export function isTransient(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504)
  );
}

export interface RetryOptions {
  /** How many times to send in total. */
  attempts: number;
  baseMs: number;
  maxMs: number;
  /** Stop retrying when this turns false (the offer expired, the screen closed). */
  alive?: () => boolean;
  /** Called before each retry (e.g. to show "reconnecting"). */
  onRetry?: (attempt: number, error: unknown) => void;
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Sends `fn` until it answers, retrying transient failures with backoff. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const wait = options.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const last = attempt + 1 >= options.attempts || (options.alive && !options.alive());
      if (!isTransient(error) || last) throw error;
      options.onRetry?.(attempt + 1, error);
      await wait(backoffMs(attempt, options.baseMs, options.maxMs, options.random?.()));
      if (options.alive && !options.alive()) throw error;
    }
  }
}

/** Offers last 15–30 s: a lost accept is re-sent quickly, a few times. */
export const ACCEPT_RETRY = { attempts: 4, baseMs: 700, maxMs: 3_000 } as const;
/** A step may wait for the network much longer: the driver is standing there. */
export const STEP_RETRY = { attempts: 8, baseMs: 1_000, maxMs: 10_000 } as const;

interface HasRide {
  id: string;
  status: string;
}

/**
 * Accepts an offer. When the answer is lost or a retry is refused (409/404), the driver's
 * current ride tells whether the accept went through: if it is this offer's ride, it did.
 */
export async function acceptOffer<R extends HasRide>(deps: {
  accept: () => Promise<R>;
  currentRide: () => Promise<R | null>;
  rideId: string;
  retry?: Partial<RetryOptions>;
}): Promise<R> {
  try {
    return await withRetry(deps.accept, { ...ACCEPT_RETRY, ...deps.retry });
  } catch (error) {
    if (!(isTransient(error) || isApiError(error, 409) || isApiError(error, 404))) throw error;
    const ride = await deps.currentRide().catch(() => null);
    if (ride && ride.id.toLowerCase() === deps.rideId.toLowerCase()) return ride;
    throw error;
  }
}

/**
 * Runs a ride step. A 409 whose ride is already at (or past) the step's status counts as
 * done — the first request went through and only its answer was lost.
 */
export async function runRideStep<R extends HasRide>(deps: {
  send: () => Promise<R>;
  fetchRide: () => Promise<R>;
  action: RideAction;
  retry?: Partial<RetryOptions>;
}): Promise<R> {
  try {
    return await withRetry(deps.send, { ...STEP_RETRY, ...deps.retry });
  } catch (error) {
    if (!isApiError(error, 409)) throw error;
    const ride = await deps.fetchRide().catch(() => null);
    if (ride && stepReached(ride.status, deps.action)) return ride;
    throw error;
  }
}
