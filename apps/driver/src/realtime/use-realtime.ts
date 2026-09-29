import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { Alert, AppState } from 'react-native';
import type { DriverRide, Topup } from '../api/types';
import { keys, setStreamOpen } from '../data/queries';
import type { RealtimeEvent } from '../lib/sse';
import { withPaidEvent } from '../lib/topup';
import { announceOffer } from '../notifications/push';
import { haptics } from '../ui/haptics';
import { RealtimeConnection } from './connection';

type Router = ReturnType<typeof useRouter>;

/**
 * Rides this driver gave up or finished on this phone: the echo of their own cancel or
 * completion must not be announced as "the rider cancelled" or "taken away".
 */
const endedHere = new Set<string>();

export function markRideEndedHere(rideId: string): void {
  endedHere.add(rideId);
}

// Offers closed by the server (taken by another driver, withdrawn, expired), so an open
// offer screen can say so at once instead of waiting for its countdown.
const closedOffers = new Map<string, string>();
const closedListeners = new Set<() => void>();

export function markOfferClosed(offerId: string, status: string): void {
  closedOffers.set(offerId.toLowerCase(), status);
  if (closedOffers.size > 50) closedOffers.delete(closedOffers.keys().next().value!);
  closedListeners.forEach((l) => l());
}

/** The server's reason an offer closed (`expired`, `withdrawn`, `taken`, …), or null. */
export function useOfferClosed(offerId: string): string | null {
  return useSyncExternalStore(
    (l) => {
      closedListeners.add(l);
      return () => closedListeners.delete(l);
    },
    () => closedOffers.get(offerId.toLowerCase()) ?? null,
  );
}

/**
 * A card top-up was paid (the `topup.updated` event or the `topup_paid` push): a watched
 * top-up is marked paid at once — its screen stops asking — and the money is refetched.
 */
export function onTopupPaid(
  qc: QueryClient,
  event: { intentId: string; status: string; amount: number },
): void {
  const key = keys.topup(event.intentId.toLowerCase());
  qc.setQueryData<Topup>(key, (t) => withPaidEvent(t, event));
  void qc.invalidateQueries({ queryKey: key });
  void qc.invalidateQueries({ queryKey: keys.topups, exact: true });
  void qc.invalidateQueries({ queryKey: keys.balance });
  void qc.invalidateQueries({ queryKey: keys.ledger });
  void qc.invalidateQueries({ queryKey: keys.me });
}

async function onRideUpdated(
  qc: QueryClient,
  router: Router,
  event: { rideId: string; status: string },
) {
  const mine = qc.getQueryData<DriverRide | null>(keys.current);
  void qc.invalidateQueries({ queryKey: keys.ride(event.rideId) });
  void qc.invalidateQueries({ queryKey: keys.me });
  if (event.status === 'completed' || event.status === 'cancelled') {
    void qc.invalidateQueries({ queryKey: keys.rides });
    void qc.invalidateQueries({ queryKey: keys.balance });
  }
  await qc.refetchQueries({ queryKey: keys.current });
  if (!mine || mine.id !== event.rideId) return;
  if (endedHere.has(mine.id)) return;

  if (event.status === 'cancelled') {
    haptics.warning();
    Alert.alert(
      `Buyurtma #${mine.number} bekor qilindi`,
      mine.status === 'driver_arrived'
        ? 'Yo‘lovchi bekor qildi. Bepul kutish tugagan bo‘lsa, bekor qilish haqi sizga yoziladi (naqd safarda — yo‘lovchi keyingi safarida to‘laganda).'
        : 'Yo‘lovchi yoki operator buyurtmani bekor qildi. Liniyada qolasiz.',
      [{ text: 'Tushunarli', onPress: () => router.navigate('/') }],
    );
    return;
  }
  const still = qc.getQueryData<DriverRide | null>(keys.current);
  if (event.status === 'searching' || (still && still.id !== mine.id) || !still) {
    if (event.status === 'completed') return;
    haptics.warning();
    Alert.alert(
      `Buyurtma #${mine.number} sizdan olindi`,
      'Operator buyurtmani boshqa haydovchiga berdi. Unga bormang.',
      [{ text: 'Tushunarli', onPress: () => router.navigate('/') }],
    );
  }
}

// While on shift with the background location service running, the stream stays open in
// the background too (the process is alive anyway): an offer is heard at once.
let keepInBackground = false;
const keepListeners = new Set<(keep: boolean) => void>();

export function setRealtimeInBackground(keep: boolean): void {
  if (keep === keepInBackground) return;
  keepInBackground = keep;
  keepListeners.forEach((l) => l(keep));
}

function onKeepInBackground(listener: (keep: boolean) => void): () => void {
  keepListeners.add(listener);
  return () => keepListeners.delete(listener);
}

/**
 * Keeps an event stream open while the app is in the foreground (and in the background
 * while on shift, see setRealtimeInBackground) and turns the API's
 * nudges into refetches. Queries also poll (fast while the stream is down), so a missed
 * event only delays an update; offers additionally come as urgent pushes.
 */
export function useRealtime(enabled: boolean): void {
  const qc = useQueryClient();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!enabled) return;

    const handle = (event: RealtimeEvent) => {
      switch (event.type) {
        case 'ready':
          // (re)connected: catch up on whatever happened while we were away
          void qc.invalidateQueries({ queryKey: ['driver'] });
          break;
        case 'offer.new':
          void qc.invalidateQueries({ queryKey: keys.offers });
          // in the background (navigator in front) the stream is kept only while on shift:
          // the offer alert sounds at once, without waiting for a push
          if (AppState.currentState !== 'active') {
            void announceOffer(event.offerId, 'Yangi buyurtma!', 'Javob berish uchun bosing');
          }
          break;
        case 'offer.closed':
          markOfferClosed(event.offerId, event.status);
          void qc.invalidateQueries({ queryKey: keys.offers });
          break;
        case 'ride.updated':
          void onRideUpdated(qc, routerRef.current, event).catch(() => undefined);
          break;
        case 'driver.updated':
          void qc.invalidateQueries({ queryKey: keys.me });
          // the heading filter clears itself when the driver gets there
          if (event.status === 'destination_reached') {
            haptics.success();
            Alert.alert(
              'Manzilga yetdingiz',
              'Yo‘nalish filtri o‘chirildi: endi hamma buyurtmalar keladi.',
            );
          }
          void qc.invalidateQueries({ queryKey: keys.appeals });
          break;
        case 'intercity.updated':
          // a booking came or was cancelled, or the trip moved on
          void qc.invalidateQueries({ queryKey: keys.trips });
          void qc.invalidateQueries({ queryKey: keys.trip(event.tripId) });
          break;
        case 'topup.updated':
          onTopupPaid(qc, event);
          break;
        case 'appeal.updated':
          // an operator answered: the appeal and maybe the account status changed
          void qc.invalidateQueries({ queryKey: keys.appeals });
          void qc.invalidateQueries({ queryKey: keys.me });
          break;
      }
    };

    const connection = new RealtimeConnection(handle, (status) => setStreamOpen(status === 'open'));
    const inForeground = () => AppState.currentState !== 'background';
    if (inForeground() || keepInBackground) connection.start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') connection.reconnectNow();
      else if (state === 'background' && !keepInBackground) connection.stop();
    });
    // leaving the shift while in the background closes the stream too
    const keepSub = onKeepInBackground((keep) => {
      if (inForeground()) return;
      if (keep) connection.start();
      else connection.stop();
    });
    // the phone's connection came back: reconnect now rather than after the backoff
    let wasConnected = true;
    const netSub = NetInfo.addEventListener((net) => {
      const connected = net.isConnected !== false;
      if (connected && !wasConnected && (inForeground() || keepInBackground)) {
        connection.reconnectNow();
      }
      wasConnected = connected;
    });
    return () => {
      sub.remove();
      keepSub();
      netSub();
      connection.stop();
      setStreamOpen(false);
    };
  }, [enabled, qc]);
}
