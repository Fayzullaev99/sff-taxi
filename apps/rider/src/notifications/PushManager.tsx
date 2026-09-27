import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { keys } from '../api/queries';
import { beforeSignOut, useIsSignedIn } from '../api/session';
import { pushTarget } from './data';
import {
  configureNotifications,
  getPushPermission,
  type PushPermission,
  pushSupported,
  requestPushPermission,
  type SyncResult,
  syncPushToken,
  unregisterPushToken,
} from './push';

/**
 * Keeps this device registered for the signed-in account's pushes and opens the ride a
 * tapped notification is about. Rendered once, inside the navigator.
 */
export function PushManager() {
  const signedIn = useIsSignedIn();
  const last = useRef<SyncResult | null>(null);

  useEffect(() => {
    void configureNotifications();
    return beforeSignOut(unregisterPushToken);
  }, []);

  // app start, sign-in; and when the rider comes back having allowed it in the settings
  useEffect(() => {
    if (!signedIn || !pushSupported) return;
    const sync = () =>
      void syncPushToken().then((r) => {
        last.current = r;
      });
    sync();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && last.current !== 'registered') sync();
    });
    const tokens = Notifications.addPushTokenListener(() => sync());
    return () => {
      appState.remove();
      tokens.remove();
    };
  }, [signedIn]);

  // a tap on a notification, also the one that launched the app
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response || !pushSupported) return;
    const key = response.notification.request.identifier;
    if (handled.current === key) return;
    handled.current = key;
    const target = pushTarget(response.notification.request.content.data);
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    if (!target) return;
    // on a cold start the first screen redirects to the map first: open the ride on top
    // (not cancelled on re-render: clearing the response above re-renders at once)
    setTimeout(() => {
      if (target.screen === 'ride') {
        router.push({ pathname: '/ride/[id]', params: { id: target.id } });
      } else if (target.screen === 'complaint') {
        router.push({ pathname: '/support/[id]', params: { id: target.id } });
      } else {
        router.push({ pathname: '/intercity/booking/[id]', params: { id: target.id } });
      }
    }, 250);
  }, [response]);

  // a push arriving while the app is open (a refund, an operator's answer): the screen
  // showing that ride or ticket refetches without waiting for its poll
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!pushSupported) return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data;
      const target = pushTarget(data);
      if (!target) return;
      if (target.screen === 'complaint') {
        void queryClient.invalidateQueries({ queryKey: keys.complaints });
        void queryClient.invalidateQueries({ queryKey: keys.complaint(target.id) });
      } else if (target.screen === 'booking') {
        void queryClient.invalidateQueries({ queryKey: keys.bookings });
        void queryClient.invalidateQueries({ queryKey: keys.booking(target.id) });
      }
      const rideId = (data as { rideId?: unknown } | null)?.rideId;
      if (typeof rideId === 'string') {
        void queryClient.invalidateQueries({ queryKey: keys.ride(rideId) });
        void queryClient.invalidateQueries({ queryKey: keys.currentRide });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  return null;
}

/** The system permission, re-read whenever the app returns to the foreground. */
export function usePushPermission() {
  const [permission, setPermission] = useState<PushPermission | null>(null);

  const refresh = useCallback(() => {
    void getPushPermission().then(setPermission);
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const request = useCallback(async (): Promise<PushPermission> => {
    // the system will not ask again: its settings screen is the only way
    if ((await getPushPermission()) === 'denied') {
      await Linking.openSettings().catch(() => undefined);
      return 'denied';
    }
    const result = await requestPushPermission();
    setPermission(result);
    return result;
  }, []);

  return { permission, request, refresh };
}
