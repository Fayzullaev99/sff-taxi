/**
 * Push notifications: the Android "rides" channel (the API sends ride pushes on it), permission,
 * the Expo push token and its registration with the API. Permission is asked at a moment
 * that explains itself (after the first ride is ordered, or from the settings), never
 * on first launch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { endpoints } from '../api/endpoints';
import { getSessionStatus } from '../api/session';
import { colors } from '../ui/theme';
import { pushLocale, pushPermissionState, resolveProjectId } from './data';

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

const TOKEN_KEY = 'sff-taxi.push-token';
const ASKED_KEY = 'sff-taxi.push-asked';

/**
 * Expo Go (Android) has no remote push since SDK 53, and the web build has no Expo
 * push at all: everything here quietly does nothing there.
 */
export const pushSupported =
  Platform.OS !== 'web' &&
  !(
    Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  );

const projectId = resolveProjectId(
  Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined,
  Constants.easConfig?.projectId,
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
);

let configured: Promise<void> | null = null;

/** Foreground presentation and the Android channel every push uses. Safe to call often. */
export function configureNotifications(): Promise<void> {
  configured ??= (async () => {
    if (!pushSupported) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('rides', {
        name: 'Safarlar',
        description: 'Haydovchi topildi, yetib keldi, buyurtma bekor qilindi',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        lightColor: colors.brand,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      }).catch(() => undefined);
    }
  })();
  return configured;
}

function toPermission(p: Notifications.NotificationPermissionsStatus): PushPermission {
  return pushPermissionState({
    granted: p.granted,
    status: p.status,
    canAskAgain: p.canAskAgain,
    provisional: p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
  });
}

export async function getPushPermission(): Promise<PushPermission> {
  if (!pushSupported) return 'unsupported';
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch {
    return 'unsupported';
  }
}

/** Shows the system prompt (the channel must exist first on Android 13+). */
export async function requestPushPermission(): Promise<PushPermission> {
  if (!pushSupported) return 'unsupported';
  await configureNotifications();
  try {
    const result = toPermission(await Notifications.requestPermissionsAsync());
    await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => undefined);
    if (result === 'granted') void syncPushToken();
    return result;
  } catch {
    return 'unsupported';
  }
}

/**
 * After a ride is ordered: the one moment the prompt explains itself ("so we can tell
 * you when the driver arrives"). Asks once; later the notification settings screen can.
 */
export async function askForPushAfterOrder(): Promise<void> {
  if (!pushSupported) return;
  const asked = await AsyncStorage.getItem(ASKED_KEY).catch(() => null);
  if (asked) {
    void syncPushToken();
    return;
  }
  if ((await getPushPermission()) === 'undetermined') await requestPushPermission();
  else void syncPushToken();
}

let lastToken: string | null = null;
let syncing: Promise<SyncResult> | null = null;

export type SyncResult = 'registered' | 'no-permission' | 'unavailable' | 'signed-out';

/**
 * Gets the Expo push token (only if permission is already granted: never prompts) and
 * tells the API. Called on app start, after sign-in and when the token changes; the
 * API refreshes `last_seen_at` each time.
 */
export function syncPushToken(knownToken?: string): Promise<SyncResult> {
  syncing ??= (async (): Promise<SyncResult> => {
    if (!pushSupported) return 'unavailable';
    if (getSessionStatus() !== 'signedIn') return 'signed-out';
    await configureNotifications();
    if ((await getPushPermission()) !== 'granted') return 'no-permission';
    if (!projectId) {
      if (__DEV__) {
        console.info(
          '[push] No EAS project id (extra.eas.projectId / EXPO_PUBLIC_EAS_PROJECT_ID): push token skipped.',
        );
      }
      return 'unavailable';
    }
    let token = knownToken ?? null;
    if (!token) {
      try {
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      } catch (error) {
        if (__DEV__) console.info('[push] No push token:', error);
        return 'unavailable';
      }
    }
    try {
      await endpoints.registerPush({
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        app: 'rider',
        locale: pushLocale(Intl.DateTimeFormat().resolvedOptions().locale),
      });
    } catch {
      // offline: the next app start registers it
      return 'unavailable';
    }
    lastToken = token;
    await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => undefined);
    return 'registered';
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** Before signing out: this device stops receiving the account's notifications. */
export async function unregisterPushToken(): Promise<void> {
  const token = lastToken ?? (await AsyncStorage.getItem(TOKEN_KEY).catch(() => null));
  if (!token) return;
  try {
    await endpoints.unregisterPush(token);
  } finally {
    lastToken = null;
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  }
}
