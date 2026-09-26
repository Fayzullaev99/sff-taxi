import { useQuery } from '@tanstack/react-query';
import { endpoints } from '../api/endpoints';
import { keys } from '../api/queries';
import type { Quote, Ride, WaitingRule } from '../api/types';

export interface RideRules {
  waiting: WaitingRule;
  cancellationFee: number;
}

/**
 * Waiting and cancellation rules of a ride. The ride keeps its quote's tariff, but the
 * rider view does not return it (API gap), so the app remembers the quote's rules for
 * the rides it ordered, and otherwise reads the published tariff at the pickup.
 */
const remembered = new Map<string, RideRules>();

export function rememberRules(rideId: string, quote: Pick<Quote, 'waiting' | 'cancellationFee'>) {
  remembered.set(rideId, { waiting: quote.waiting, cancellationFee: quote.cancellationFee });
}

export function useRideRules(ride: Ride | undefined): RideRules | null {
  const known = ride ? remembered.get(ride.id) : undefined;
  const needed = Boolean(
    ride && !known && ride.status !== 'completed' && ride.status !== 'cancelled',
  );
  const tariff = useQuery({
    queryKey: keys.tariff(ride?.pickup ?? { lat: 0, lng: 0 }),
    queryFn: () => endpoints.tariff(ride!.pickup),
    enabled: needed,
    staleTime: 10 * 60_000,
  });
  if (known) return known;
  const t = tariff.data?.tariff;
  return t ? { waiting: t.waiting, cancellationFee: t.cancellation_fee } : null;
}
