// Defines the background location task at start-up (Android may launch JS just for it).
import '../location/tracker';
// Sets the foreground notification handler before anything can arrive.
import '../notifications/push';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../auth/session';
import { createQueryClient, useDriverMe } from '../data/queries';
import { installReactQueryNativeBindings } from '../data/react-native';
import { errorMessage } from '../lib/api-client';
import { usePushIntro, usePushRegistration } from '../notifications/use-push';
import { DriverRuntime } from '../realtime/driver-runtime';
import { Button, ErrorState, Loading } from '../ui/components';
import { NotificationsIntro } from '../ui/notifications-intro';
import { colors, space } from '../ui/theme';

installReactQueryNativeBindings();

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="light" />
          <RootNavigator />
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
  const signedIn = session.status === 'signedIn';
  const me = useDriverMe(signedIn);
  const active = signedIn && me.data?.status === 'active';
  // registered on every start and sign-in, applicants too (approval comes as a push)
  usePushRegistration(signedIn);
  const intro = usePushIntro(active);

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
      {active ? <DriverRuntime /> : null}
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
        </Stack.Protected>
      </Stack>
    </>
  );
}
