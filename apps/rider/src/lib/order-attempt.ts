/**
 * One clientRequestId per order attempt (pure, unit-tested). The API returns the same
 * ride for a repeated clientRequestId, so a retry after a timeout can never create a
 * second ride; but it ignores the body of a repeat, so a changed order (another class,
 * another quote, a new comment) must get a new id.
 */

export type AttemptOutcome =
  /** The ride exists: the next order is a new attempt. */
  | 'created'
  /** The API refused it (expired quote, validation): nothing was created. */
  | 'rejected'
  /** No answer (offline, timeout): the ride may exist, retry with the same id. */
  | 'unknown';

export class OrderAttempts {
  private key: string | null = null;
  private id: string | null = null;

  constructor(private readonly makeId: () => string) {}

  /** The id for an order with this content: the same while it is being retried. */
  idFor(key: string): string {
    if (this.id === null || this.key !== key) {
      this.key = key;
      this.id = this.makeId();
    }
    return this.id;
  }

  settle(outcome: AttemptOutcome): void {
    if (outcome === 'unknown') return;
    this.key = null;
    this.id = null;
  }

  get pending(): string | null {
    return this.id;
  }
}

/** Everything the API reads from an order, as a stable key. */
export function orderKey(input: {
  quoteId: string;
  class: string;
  paymentMethod: string;
  pickup: { address: string | null; landmark: string | null };
  dropoff: { address: string | null; landmark: string | null };
  comment: string | null;
  passengers?: number;
  shareable?: boolean;
  womenOnly?: boolean;
  fareMode?: string;
  cargo?: unknown;
  parcel?: unknown;
  recipient?: unknown;
}): string {
  return JSON.stringify([
    input.cargo ?? null,
    input.parcel ?? null,
    input.recipient ?? null,
    input.passengers ?? 1,
    input.shareable ?? false,
    input.womenOnly ?? false,
    input.fareMode ?? 'car',
    input.quoteId,
    input.class,
    input.paymentMethod,
    input.pickup.address,
    input.pickup.landmark,
    input.dropoff.address,
    input.dropoff.landmark,
    input.comment,
  ]);
}
