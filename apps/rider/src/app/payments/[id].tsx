import { router } from 'expo-router';
import { useEffect } from 'react';
import { endpoints } from '../../api/endpoints';
import { LoadingView } from '../../ui/states';

/**
 * sfftaxi://payments/{intentId}: where Payme/Click send the rider back after paying (the
 * API's PAYMENT_RETURN_URL). The ride screen underneath follows the payment by itself, so
 * this only returns there: back if there is a screen to go back to, else the open ride.
 */
export default function PaymentReturn() {
  useEffect(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    void endpoints
      .currentRide()
      .then(({ ride }) =>
        ride
          ? router.replace({ pathname: '/ride/[id]', params: { id: ride.id } })
          : router.replace('/home'),
      )
      .catch(() => router.replace('/home'));
  }, []);
  return <LoadingView label="To‘lov tekshirilmoqda…" />;
}
