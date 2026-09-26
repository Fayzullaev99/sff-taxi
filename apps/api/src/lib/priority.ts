/**
 * The driver's priority score, 0-100, shown to the driver with its parts (like Yandex's
 * transparent "priority" in Uzbekistan, market analysis §1.5). It is only a tie-breaker in
 * dispatch: between drivers whose road ETAs are within the tie window, the higher score
 * gets the offer; the nearest driver otherwise always wins.
 *
 * Each part starts from a prior, so a new driver is not punished for having no history:
 * - acceptance: accepted / received offers, prior 8 of 10 accepted;
 * - reliability: 1 - rides cancelled after accepting / accepted, prior 10 clean rides;
 * - rating: average stars, prior five 4.8-star ratings, mapped from 1..5 to 0..1.
 */
export interface PriorityInputs {
  offersReceived: number;
  offersAccepted: number;
  ridesCancelled: number;
  ratingSum: number;
  ratingCount: number;
}

export const PRIORITY_WEIGHTS = { acceptance: 0.4, reliability: 0.3, rating: 0.3 } as const;

export interface Priority {
  score: number;
  acceptance: number;
  reliability: number;
  rating: number;
  /** Average stars with the prior, one decimal. */
  stars: number;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function priority(i: PriorityInputs): Priority {
  const acceptance = (i.offersAccepted + 8) / (i.offersReceived + 10);
  const reliability = Math.max(0, 1 - i.ridesCancelled / (i.offersAccepted + 10));
  const stars = (i.ratingSum + 5 * 4.8) / (i.ratingCount + 5);
  const rating = (stars - 1) / 4;
  const raw =
    PRIORITY_WEIGHTS.acceptance * Math.min(1, acceptance) +
    PRIORITY_WEIGHTS.reliability * reliability +
    PRIORITY_WEIGHTS.rating * rating;
  return {
    score: Math.max(0, Math.min(100, Math.round(raw * 100))),
    acceptance: round3(Math.min(1, acceptance)),
    reliability: round3(reliability),
    rating: round3(rating),
    stars: Math.round(stars * 10) / 10,
  };
}
