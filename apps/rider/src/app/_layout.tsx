import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useState } from 'react';
import { AppState, InteractionManager } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { endpoints } from '../api/endpoints';
import { clearAccountData, queryClient } from '../api/queries';
import { RealtimeProvider } from '../api/realtime';
import { forgetOpenRide, keepOpenRide, restoreOpenRide } from '../api/ride-cache';
import {
  getSessionStatus,
  hydrateSession,
  onSignedOut,
  useIsSignedIn,
  useSessionStatus,
} from '../api/session';
import { initLanguage, onLanguageChange, useT } from '../i18n';
import { pendingInvite } from '../lib/pending-invite';
import { PushManager } from '../notifications/PushManager';
import { syncPushToken } from '../notifications/push';
import { resetDraft } from '../trip/draft';
import { clearLegacyPlaces, migrateLegacyPlaces } from '../trip/places-store';
import { OfflineFrame } from '../ui/OfflineBanner';
import { RideNoticeBanner } from '../ui/RideNoticeBanner';
import { colors } from '../ui/theme';
import { UpdateRequired } from '../ui/UpdateRequired';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // the language (saved, else the phone's) and the saved session, then the open ride
    // kept on the phone (a cold start offline still shows it), then the first screen
    void Promise.all([initLanguage(), hydrateSession()])
      .then(() => (getSessionStatus() === 'signedIn' ? restoreOpenRide() : undefined))
      .catch(() => undefined)
      .finally(() => setReady(true));
    const stopKeeping = keepOpenRide();
    const stopListening = onSignedOut(() => {
      forgetOpenRide();
      clearAccountData();
      clearLegacyPlaces();
      resetDraft();
    });
    // a switched language: the API keeps it (SMS, push), the push device is re-registered
    // in it, and everything the API worded (class names, labels, quick replies) is refetched
    const stopLanguage = onLanguageChange((lang) => {
      if (getSessionStatus() === 'signedIn') {
        void endpoints.updateLocale(lang).catch(() => undefined);
        void syncPushToken();
      }
      void queryClient.invalidateQueries();
    });
    // refetch stale queries when the app comes back to the foreground
    const sub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => {
      stopKeeping();
      stopListening();
      stopLanguage();
      sub.remove();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <RealtimeProvider>
          <StatusBar style="dark" />
          <OfflineFrame>
            <Gate ready={ready}>
              <Screens />
              <SessionGuard />
              <AfterStart>
                <PlacesMigration />
                <PushManager />
                <PendingInvite />
              </AfterStart>
              <UpdateRequired />
              <RideNoticeBanner />
            </Gate>
          </OfflineFrame>
        </RealtimeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/** Keeps the splash screen up until the saved session is read. */
function Gate({ ready, children }: { ready: boolean; children: ReactNode }) {
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  return ready ? children : null;
}

/**
 * Work that is not needed for the first screen (push registration, moving old saved
 * places) starts once the start-up animations and the first render are done: a faster
 * cold start on low-end phones.
 */
function AfterStart({ children }: { children: ReactNode }) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setGo(true));
    return () => task.cancel();
  }, []);
  return go ? children : null;
}

/** A session that ended (signed out, refresh token rejected) leads back to the sign-in. */
function SessionGuard() {
  const status = useSessionStatus();
  const segments = useSegments();
  const onSignIn = segments[0] === 'sign-in';
  // the index route (no segment) redirects by itself
  const atStart = (segments as string[]).length === 0;
  useEffect(() => {
    if (status === 'signedOut' && !onSignIn && !atStart) router.replace('/sign-in');
  }, [status, onSignIn, atStart]);
  return null;
}

/** An invitation link opened before the sign-in: offered again once signed in. */
function PendingInvite() {
  const signedIn = useIsSignedIn();
  const segments = useSegments();
  const onInvite = segments[0] === 'invite';
  useEffect(() => {
    if (!signedIn || onInvite) return;
    void pendingInvite.get().then((code) => {
      if (!code) return;
      // the invite screen takes it from here (it forgets the kept code)
      void pendingInvite.set(null);
      router.push({ pathname: '/invite/[code]', params: { code } });
    });
  }, [signedIn, onInvite]);
  return null;
}

/** Home and work kept on the phone by older versions move to the account, once. */
function PlacesMigration() {
  const signedIn = useIsSignedIn();
  useEffect(() => {
    if (signedIn) void migrateLegacyPlaces();
  }, [signedIn]);
  return null;
}

function Screens() {
  const { t } = useT();
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false, title: t('common.screens.map') }} />
      <Stack.Screen
        name="search"
        options={{ title: t('common.screens.search'), animation: 'slide_from_bottom' }}
      />
      <Stack.Screen name="pick-on-map" options={{ title: t('common.screens.pickOnMap') }} />
      <Stack.Screen name="order" options={{ title: t('common.screens.order') }} />
      <Stack.Screen name="cargo" options={{ title: t('common.screens.cargo') }} />
      <Stack.Screen
        name="ride/[id]"
        options={{ headerShown: false, gestureEnabled: false, title: t('common.screens.ride') }}
      />
      <Stack.Screen name="history" options={{ title: t('common.screens.history') }} />
      <Stack.Screen name="scheduled" options={{ title: t('common.screens.scheduled') }} />
      <Stack.Screen name="profile" options={{ title: t('common.screens.profile') }} />
      <Stack.Screen name="places" options={{ title: t('common.screens.places') }} />
      <Stack.Screen name="promos" options={{ title: t('common.screens.promos') }} />
      <Stack.Screen name="invite/[code]" options={{ title: t('common.screens.invite') }} />
      <Stack.Screen name="chat/[rideId]" options={{ title: t('common.screens.chat') }} />
      <Stack.Screen name="support/index" options={{ title: t('common.screens.support') }} />
      <Stack.Screen name="support/new" options={{ title: t('common.screens.complaint') }} />
      <Stack.Screen name="support/[id]" options={{ title: t('common.screens.complaint') }} />
      <Stack.Screen name="intercity/index" options={{ title: t('common.screens.intercity') }} />
      <Stack.Screen name="intercity/trip/[id]" options={{ title: t('common.screens.trip') }} />
      <Stack.Screen name="intercity/bookings" options={{ title: t('common.screens.bookings') }} />
      <Stack.Screen
        name="intercity/booking/[id]"
        options={{ title: t('common.screens.booking') }}
      />
      <Stack.Screen
        name="payments/[id]"
        options={{ headerShown: false, animation: 'none', title: t('common.screens.payment') }}
      />
    </Stack>
  );
}
