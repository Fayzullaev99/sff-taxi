import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { DriverMe } from '../api/types';
import { keys } from '../data/queries';
import { pushTarget } from '../lib/refresh';
import { onTopupPaid } from '../realtime/use-realtime';
import {
  getPushPermission,
  markPushIntroSeen,
  pushIntroSeen,
  type PushPermission,
  registerPushDevice,
} from './push';

/** Re-register at most this often when the app comes back to the foreground. */
const REFRESH_EVERY_MS = 30 * 60_000;

/**
 * Keeps this install registered for the signed-in driver: at start and sign-in, when
 * Expo hands out a new token, and when the driver returns from the settings page
 * having switched notifications on.
 */
export function usePushRegistration(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let lastAt = Date.now();
    let lastPermission: PushPermission | null = null;
    void registerPushDevice();
    void getPushPermission().then((p) => (lastPermission = p));

    const tokenSub = Notifications.addPushTokenListener(() => void registerPushDevice());
    const appSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void getPushPermission().then((p) => {
        const newlyGranted = p === 'granted' && lastPermission !== 'granted';
        lastPermission = p;
        if (newlyGranted || Date.now() - lastAt > REFRESH_EVERY_MS) {
          lastAt = Date.now();
          void registerPushDevice();
        }
      });
    });
    return () => {
      tokenSub.remove();
      appSub.remove();
    };
  }, [enabled]);
}

/** The OS permission, refreshed whenever the app returns to the foreground. */
export function usePushPermission(): {
  permission: PushPermission | undefined;
  refresh: () => Promise<void>;
} {
  const [permission, setPermission] = useState<PushPermission>();
  const refresh = useCallback(async () => setPermission(await getPushPermission()), []);
  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => sub.remove();
  }, [refresh]);
  return { permission, refresh };
}

/** Whether to show the "why notifications" step: once per phone, while the system has not asked. */
export function usePushIntro(enabled: boolean): { needed: boolean | undefined; done: () => void } {
  const [needed, setNeeded] = useState<boolean>();
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void Promise.all([getPushPermission(), pushIntroSeen()]).then(([permission, seen]) => {
      if (alive) setNeeded(permission === 'undetermined' && !seen);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  const done = useCallback(() => {
    setNeeded(false);
    void markPushIntroSeen();
  }, []);
  return { needed: enabled ? needed : false, done };
}

/**
 * Opens what a tapped notification is about (also the tap that launched the app): an
 * offer opens full-screen, a ride opens the ride, a paid top-up its screen, an answered
 * appeal the appeals, an account change opens home. Pushes
 * arriving while the app is open refresh the affected data at once.
 */
export function useNotificationRouting(enabled: boolean): void {
  const router = useRouter();
  const qc = useQueryClient();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || !response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.current.has(id)) return;
    handled.current.add(id);
    Notifications.clearLastNotificationResponse();
    const target = pushTarget(response.notification.request.content.data);
    if (!target) return;
    const isActive = () => qc.getQueryData<DriverMe | null>(keys.me)?.status === 'active';
    if (target.kind === 'offer') {
      void qc.invalidateQueries({ queryKey: keys.offers });
      router.navigate(`/offer/${target.offerId}`);
    } else if (target.kind === 'ride') {
      void qc.invalidateQueries({ queryKey: keys.current });
      router.navigate('/ride');
    } else if (target.kind === 'trip') {
      void qc.invalidateQueries({ queryKey: keys.trip(target.tripId) });
      router.navigate(`/intercity/${target.tripId}`);
    } else if (target.kind === 'topup') {
      if (target.intentId) {
        onTopupPaid(qc, { intentId: target.intentId, status: 'paid', amount: 0 });
      }
      // the work screens (top-up, money) exist for an approved driver only
      if (!isActive()) router.navigate('/');
      else if (target.intentId) router.navigate(`/topup?id=${target.intentId}`);
      else router.navigate('/money');
    } else if (target.kind === 'appeal') {
      void qc.invalidateQueries({ queryKey: keys.appeals });
      void qc.invalidateQueries({ queryKey: keys.me });
      // unblocked by the answer: home says so; still rejected/blocked: the answer itself
      router.navigate(isActive() ? '/' : '/appeals');
    } else {
      void qc.invalidateQueries({ queryKey: keys.me });
      router.navigate('/');
    }
  }, [enabled, response, router, qc]);

  useEffect(() => {
    if (!enabled) return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const target = pushTarget(n.request.content.data);
      if (target?.kind === 'offer') void qc.invalidateQueries({ queryKey: keys.offers });
      if (target?.kind === 'ride') void qc.invalidateQueries({ queryKey: keys.current });
      if (target?.kind === 'home') void qc.invalidateQueries({ queryKey: keys.me });
      if (target?.kind === 'topup' && target.intentId) {
        onTopupPaid(qc, { intentId: target.intentId, status: 'paid', amount: 0 });
      }
      if (target?.kind === 'appeal') {
        void qc.invalidateQueries({ queryKey: keys.appeals });
        void qc.invalidateQueries({ queryKey: keys.me });
      }
      if (target?.kind === 'trip') {
        void qc.invalidateQueries({ queryKey: keys.trip(target.tripId) });
        void qc.invalidateQueries({ queryKey: keys.trips });
      }
    });
    return () => sub.remove();
  }, [enabled, qc]);
}
