// Defines the background location task at start-up (Android may launch JS just for it).
import '../location/tracker';
// Sets the foreground notification handler before anything can arrive.
import '../notifications/push';

import { QueryClientProvider } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../auth/session';
import { persistSnapshots, restoreSnapshot } from '../data/persist';
import { createQueryClient, useDriverMe, usePublicConfig } from '../data/queries';
import { installReactQueryNativeBindings } from '../data/react-native';
import { errorMessage } from '../lib/api-client';
import { storeUrlFor } from '../lib/driver-config';
import { mustUpdate } from '../lib/version';
import { usePushIntro, usePushRegistration } from '../notifications/use-push';
import { ApplicantRuntime, DriverRuntime } from '../realtime/driver-runtime';
import { Button, ErrorState, Loading } from '../ui/components';
import { ForcedUpdate } from '../ui/forced-update';
import { NotificationsIntro } from '../ui/notifications-intro';
import { colors, space } from '../ui/theme';

installReactQueryNativeBindings();

/** This build's version (app.json), compared with the API's minimum. */
const APP_VERSION = Constants.expoConfig?.version ?? null;

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  // the last known profile and ride are shown at once after a cold start (then refetched)
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    void restoreSnapshot(queryClient).finally(() => setRestored(true));
    return persistSnapshots(queryClient);
  }, [queryClient]);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="light" />
          {restored ? (
            <RootNavigator />
          ) : (
            <View style={{ flex: 1, backgroundColor: colors.background }} />
          )}
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/**
 * Which part of the app the account may see: signed out → sign-in; no application or not
 * approved (pending, rejected, blocked) → application and status; approved → the work
 * screens, with the realtime/GPS/offer runtime mounted once for all of them.
 */
function RootNavigator() {
  const session = useSession();
  const config = usePublicConfig();
  const signedIn = session.status === 'signedIn';
  const me = useDriverMe(signedIn);
  const active = signedIn && me.data?.status === 'active';
  // registered on every start and sign-in, applicants too (approval comes as a push)
  usePushRegistration(signedIn);
  const intro = usePushIntro(active);

  const minimum = config.data?.minDriverVersion ?? null;
  // too old for the API: only the update screen (never blocks while the config is unknown)
  if (APP_VERSION && minimum && mustUpdate(APP_VERSION, minimum)) {
    return (
      <ForcedUpdate
        current={APP_VERSION}
        minimum={minimum}
        storeUrl={config.data ? storeUrlFor(config.data.storeUrls, Platform.OS) : null}
      />
    );
  }
  if (session.status === 'loading' || (signedIn && me.isPending) || intro.needed === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Loading />
      </View>
    );
  }
  if (signedIn && me.data === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: space.lg }}>
        <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} />
        <Button title="Chiqish" variant="ghost" onPress={() => void session.signOut()} />
      </View>
    );
  }
  if (intro.needed) return <NotificationsIntro onDone={intro.done} />;

  return (
    <>
      {active ? <DriverRuntime /> : signedIn && me.data ? <ApplicantRuntime /> : null}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !active}>
          <Stack.Screen name="status" />
          <Stack.Screen name="apply" />
          <Stack.Screen name="appeals" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="documents" />
        </Stack.Protected>
        <Stack.Protected guard={active}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="offer/[id]"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen name="ride" options={{ gestureEnabled: false }} />
          <Stack.Screen name="ride-done/[id]" options={{ gestureEnabled: false }} />
          <Stack.Screen name="ledger" />
          <Stack.Screen name="rides" />
          <Stack.Screen name="topup" />
          <Stack.Screen name="intercity/new" />
          <Stack.Screen name="intercity/[id]" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
