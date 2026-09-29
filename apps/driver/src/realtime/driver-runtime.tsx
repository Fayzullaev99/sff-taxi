import { useQueryClient } from '@tanstack/react-query';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { serverClock } from '../api/client';
import { keys, useCurrentRide, useDriverMe, useOffers } from '../data/queries';
import { isApiError } from '../lib/api-client';
import { offerToShow } from '../lib/refresh';
import { trackingPhase } from '../lib/location-policy';
import { setTrackingErrorHandler, setTrackingPhase, stopTracking } from '../location/tracker';
import { useTrackingMode } from '../location/use-tracking-mode';
import { useNotificationRouting } from '../notifications/use-push';
import { haptics } from '../ui/haptics';
import { setRealtimeInBackground, useRealtime } from './use-realtime';

const KEEP_AWAKE_TAG = 'on-ride';

/** Offers answered, dismissed or timed out on this phone: never shown again. */
export const handledOffers = new Set<string>();

/**
 * Everything an approved driver's app does in the background of every screen: the event
 * stream, push taps, GPS reporting while online or on a ride, keeping the screen on
 * during a ride, opening a new offer full-screen, and jumping to a ride an operator
 * assigned. Renders nothing.
 */
export function DriverRuntime() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const me = useDriverMe();
  const current = useCurrentRide();
  const ride = current.data ?? null;
  const online = me.data?.isOnline ?? false;
  const offers = useOffers(online, ride !== null);

  useRealtime(true);
  useNotificationRouting(true);

  // report the position while online or on a ride (the rider follows the car), paced by
  // what the driver is doing; offline without a ride the GPS is off
  const phase = trackingPhase(online || ride !== null, ride?.status);
  useEffect(() => {
    void setTrackingPhase(phase);
  }, [phase]);
  useEffect(() => () => void stopTracking(), []);

  // with the background location service running, offers are heard over the stream
  // even with the navigator in front
  const mode = useTrackingMode();
  const keepStream = phase !== 'off' && mode === 'background';
  useEffect(() => {
    setRealtimeInBackground(keepStream);
    return () => setRealtimeInBackground(false);
  }, [keepStream]);

  useEffect(() => {
    setTrackingErrorHandler((error) => {
      // e.g. blocked mid-shift: the profile tells the app what to show
      if (isApiError(error, 403)) void qc.invalidateQueries({ queryKey: keys.me });
    });
    return () => setTrackingErrorHandler(null);
  }, [qc]);

  // the screen stays on while driving someone
  const onRide = ride !== null;
  useEffect(() => {
    if (!onRide) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [onRide]);

  // a new offer opens full-screen wherever the driver is
  const nextOfferId = offerToShow(offers.data, handledOffers, serverClock.now())?.id ?? null;
  const showing = pathname.startsWith('/offer/');
  useEffect(() => {
    if (nextOfferId && !showing) router.navigate(`/offer/${nextOfferId}`);
  }, [nextOfferId, showing, router]);

  // a ride that appears (accepted elsewhere, assigned by an operator) opens the ride screen
  const lastRideId = useRef<string | null>(null);
  const rideId = ride?.id ?? null;
  useEffect(() => {
    // (while the offer screen is open it moves to the ride itself after accepting)
    if (rideId && rideId !== lastRideId.current && pathname !== '/ride' && !showing) {
      haptics.warning();
      router.navigate('/ride');
    }
    lastRideId.current = rideId;
  }, [rideId, pathname, showing, router]);

  return null;
}

/**
 * For a driver who applied but cannot work (pending, rejected, blocked): only the event
 * stream and push taps — the decision (`driver.updated`) and an operator's answer to an
 * appeal (`appeal.updated`, the `appeal_resolved` push) arrive at once. No GPS, no offers.
 */
export function ApplicantRuntime() {
  useRealtime(true);
  useNotificationRouting(true);
  return null;
}
