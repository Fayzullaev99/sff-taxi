import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useState } from 'react';
import { AppState, InteractionManager } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import { PushManager } from '../notifications/PushManager';
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
    // the saved session, then the open ride kept on the phone (a cold start offline
    // still shows it), then the first screen
    void hydrateSession()
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
    // refetch stale queries when the app comes back to the foreground
    const sub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => {
      stopKeeping();
      stopListening();
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

/** Home and work kept on the phone by older versions move to the account, once. */
function PlacesMigration() {
  const signedIn = useIsSignedIn();
  useEffect(() => {
    if (signedIn) void migrateLegacyPlaces();
  }, [signedIn]);
  return null;
}

function Screens() {
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
      <Stack.Screen name="home" options={{ headerShown: false, title: 'Xarita' }} />
      <Stack.Screen name="search" options={{ title: 'Qayerga?', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="pick-on-map" options={{ title: 'Xaritada belgilang' }} />
      <Stack.Screen name="order" options={{ title: 'Tarifni tanlang' }} />
      <Stack.Screen name="cargo" options={{ title: 'Yuk tashish' }} />
      <Stack.Screen
        name="ride/[id]"
        options={{ headerShown: false, gestureEnabled: false, title: 'Safar' }}
      />
      <Stack.Screen name="history" options={{ title: 'Safarlar tarixi' }} />
      <Stack.Screen name="scheduled" options={{ title: 'Oldindan buyurtmalar' }} />
      <Stack.Screen name="profile" options={{ title: 'Profil va sozlamalar' }} />
      <Stack.Screen name="places" options={{ title: 'Saqlangan manzillar' }} />
      <Stack.Screen name="support/index" options={{ title: 'Murojaatlarim' }} />
      <Stack.Screen name="support/new" options={{ title: 'Murojaat' }} />
      <Stack.Screen name="support/[id]" options={{ title: 'Murojaat' }} />
      <Stack.Screen name="intercity/index" options={{ title: 'Shaharlararo' }} />
      <Stack.Screen name="intercity/trip/[id]" options={{ title: 'Qatnov' }} />
      <Stack.Screen name="intercity/bookings" options={{ title: 'Bronlarim' }} />
      <Stack.Screen name="intercity/booking/[id]" options={{ title: 'Bron' }} />
      <Stack.Screen
        name="payments/[id]"
        options={{ headerShown: false, animation: 'none', title: 'To‘lov' }}
      />
    </Stack>
  );
}
