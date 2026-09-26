import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { clearAccountData, queryClient } from '../api/queries';
import { RealtimeProvider } from '../api/realtime';
import { hydrateSession, onSignedOut, useSessionStatus } from '../api/session';
import { PushManager } from '../notifications/PushManager';
import { resetDraft } from '../trip/draft';
import { clearPlaces, loadPlaces } from '../trip/places-store';
import { OfflineBanner } from '../ui/OfflineBanner';
import { colors } from '../ui/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void Promise.all([hydrateSession(), loadPlaces()]).finally(() => setReady(true));
    const stopListening = onSignedOut(() => {
      clearAccountData();
      clearPlaces();
      resetDraft();
    });
    // refetch stale queries when the app comes back to the foreground
    const sub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => {
      stopListening();
      sub.remove();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <RealtimeProvider>
          <StatusBar style="dark" />
          <Gate ready={ready}>
            <Screens />
            <SessionGuard />
            <PushManager />
          </Gate>
          <OfflineBanner />
        </RealtimeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/** Keeps the splash screen up until the saved session and places are read. */
function Gate({ ready, children }: { ready: boolean; children: ReactNode }) {
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  return ready ? children : null;
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
      <Stack.Screen
        name="ride/[id]"
        options={{ headerShown: false, gestureEnabled: false, title: 'Safar' }}
      />
      <Stack.Screen name="history" options={{ title: 'Safarlar tarixi' }} />
      <Stack.Screen name="profile" options={{ title: 'Profil va sozlamalar' }} />
    </Stack>
  );
}
