import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ApiError, describeError, isOffline } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys } from '../api/queries';
import type { OrderInput } from '../api/types';
import { OrderAttempts, orderKey } from '../lib/order-attempt';
import { askForPushAfterOrder } from '../notifications/push';
import { resetAfterOrder } from '../trip/draft';
import { refreshRecentPlaces } from '../trip/places-store';
import { markRideShown } from '../trip/shown-rides';

/**
 * Placing an order (taxi, delivery, cargo): one clientRequestId per attempt, so a retry
 * after a timeout never orders twice; a 409 opens the open ride; an expired quote is
 * priced again; then the ride screen (a deposit or a card ride shows its payment there).
 */
export function useOrderSubmit(onQuoteExpired: () => void) {
  const queryClient = useQueryClient();
  const attempts = useRef(new OrderAttempts(() => Crypto.randomUUID())).current;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once the order went through: the draft is reset while the screen leaves. */
  const leaving = useRef(false);

  const submit = async (input: Omit<OrderInput, 'clientRequestId'>) => {
    if (busy) return;
    const clientRequestId = attempts.idFor(orderKey(input));
    setBusy(true);
    setError(null);
    try {
      const { data: ride } = await endpoints.order({ ...input, clientRequestId });
      attempts.settle('created');
      refreshRecentPlaces();
      queryClient.setQueryData(keys.ride(ride.id), ride);
      // a ride for later does not block riding now: it is not the current ride
      if (ride.status === 'scheduled' || ride.scheduledFor) {
        void queryClient.invalidateQueries({ queryKey: keys.scheduled });
      }
      if (ride.status !== 'scheduled') queryClient.setQueryData(keys.currentRide, ride);
      void queryClient.invalidateQueries({ queryKey: keys.history });
      leaving.current = true;
      markRideShown(ride.id);
      router.replace({ pathname: '/ride/[id]', params: { id: ride.id } });
      resetAfterOrder();
      void askForPushAfterOrder();
    } catch (e) {
      if (isOffline(e)) {
        // the ride may exist: the same clientRequestId on retry returns it, never a second one
        attempts.settle('unknown');
        setError('Aloqa yo‘q. Qayta bosing — buyurtma ikki marta tushmaydi.');
      } else if (e instanceof ApiError && e.status === 409) {
        attempts.settle('rejected');
        const rideId = (e.body as { rideId?: unknown } | null)?.rideId;
        if (typeof rideId === 'string') {
          leaving.current = true;
          markRideShown(rideId);
          router.replace({ pathname: '/ride/[id]', params: { id: rideId } });
          return;
        }
        setError(describeError(e));
      } else if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
        attempts.settle('rejected');
        setError('Narx yangilandi, qaytadan tasdiqlang.');
        onQuoteExpired();
      } else if (e instanceof ApiError && e.status >= 500) {
        attempts.settle('unknown');
        setError(describeError(e));
      } else {
        attempts.settle('rejected');
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return { submit, busy, error, setError, leaving };
}
