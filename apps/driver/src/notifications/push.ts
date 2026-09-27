import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { devices } from '../api/driver';
import { BRAND } from '../config';
import { type PushPermission, pushPermissionState } from '../lib/push-permission';

/**
 * Push notifications. The API sends urgent offer pushes on the Android channel `offers`
 * (expiring with the offer) and everything else on `rides` (apps/api notifier.ts). This app
 * creates both: `offers` with maximum importance, its own loud sound
 * (assets/sounds/offer_alert.wav, bundled by the expo-notifications plugin) and a long
 * vibration, so an offer is heard with the phone in a holder and the navigator in front.
 *
 * While the app is open, an offer that arrives over the event stream is announced by a
 * local notification on the same channel (same sound) — the push for the same offer is
 * then kept silent, so the driver hears each offer once.
 */
export const OFFERS_CHANNEL = 'offers';
export const RIDES_CHANNEL = 'rides';
export const OFFER_SOUND = 'offer_alert.wav';
export const OFFER_VIBRATION = [0, 500, 250, 500, 250, 800];

const INTRO_SEEN_KEY = 'sff.taxi.driver.pushIntroSeen';

/** Offers already announced on this phone (by the stream or by a push). */
const announced = new Set<string>();

function offerIdOf(data: unknown): string | null {
  const d = data as { kind?: unknown; offerId?: unknown } | null;
  return d && (d.kind === 'offer' || d.kind === 'offer_local') && typeof d.offerId === 'string'
    ? d.offerId.toLowerCase()
    : null;
}

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const data = n.request.content.data;
    const offerId = offerIdOf(data);
    const local = (data as { kind?: unknown } | null)?.kind === 'offer_local';
    if (offerId && !local) {
      // the push for an offer the stream already announced: stay quiet
      if (announced.has(offerId)) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      announced.add(offerId);
    }
    return {
      // the full-screen offer is already open for local alerts: sound, no banner over it
      shouldShowBanner: !local,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

let channels: Promise<void> | null = null;

/**
 * Creates the channels (Android 8+). They must exist before asking for permission on
 * Android 13+, or the system prompt does not appear. A channel's sound cannot be changed
 * once created: a new sound needs a new channel id on the API side too.
 */
export function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channels ??= Promise.all([
    Notifications.setNotificationChannelAsync(OFFERS_CHANNEL, {
      name: 'Yangi buyurtmalar',
      description: 'Sizga taklif qilingan buyurtmalar (15 soniyada javob bering)',
      importance: Notifications.AndroidImportance.MAX,
      sound: OFFER_SOUND,
      vibrationPattern: OFFER_VIBRATION,
      enableVibrate: true,
      enableLights: true,
      lightColor: BRAND,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: true,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    }),
    Notifications.setNotificationChannelAsync(RIDES_CHANNEL, {
      name: 'Safarlar va hisob',
      description: 'Yo‘lovchi bekor qildi, ariza holati, hisob o‘zgarishlari',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 300, 200, 300],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }),
  ])
    .then(() => undefined)
    .catch((error: unknown) => {
      channels = null;
      console.warn('[push] could not create the channels', error);
    });
  return channels;
}

/**
 * Sounds the offer alert for an offer that came over the event stream while the app is
 * open. Returns the notification id (to dismiss it once answered), or null when this
 * offer was already announced or notifications are off.
 */
export async function announceOffer(
  offerId: string,
  title: string,
  body: string,
): Promise<string | null> {
  const id = offerId.toLowerCase();
  if (announced.has(id)) return null;
  announced.add(id);
  try {
    await ensureChannels();
    return await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { kind: 'offer_local', offerId: id },
        sound: OFFER_SOUND,
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: OFFER_VIBRATION,
      },
      trigger: Platform.OS === 'android' ? { channelId: OFFERS_CHANNEL } : null,
    });
  } catch (error) {
    console.warn('[push] offer alert failed', error);
    return null;
  }
}

export async function dismissNotification(id: string | null): Promise<void> {
  if (!id) return;
  await Notifications.dismissNotificationAsync(id).catch(() => undefined);
}

export type { PushPermission };

/** The OS permission as the app acts on it (see `pushPermissionState`). */
export async function getPushPermission(): Promise<PushPermission> {
  try {
    const [p, introSeen] = await Promise.all([
      Notifications.getPermissionsAsync(),
      pushIntroSeen(),
    ]);
    return pushPermissionState(p, introSeen);
  } catch {
    return 'denied';
  }
}

/** Shows the system prompt; true when the driver allowed notifications. */
export async function requestPushPermission(): Promise<boolean> {
  await ensureChannels();
  try {
    const p = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: true, allowCriticalAlerts: false },
    });
    return p.granted;
  } catch {
    return false;
  }
}

function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return (
    extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    null
  );
}

let warnedNoProject = false;
let currentToken: string | null = null;

async function expoToken(): Promise<string | null> {
  const projectId = easProjectId();
  if (!projectId) {
    if (!warnedNoProject) {
      warnedNoProject = true;
      console.warn('[push] no EAS projectId configured: push notifications are off');
    }
    return null;
  }
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

/**
 * Registers this install for the signed-in driver (`PUT /v1/devices`). Called on every
 * app start and sign-in and when the token changes. Does nothing until notifications are
 * allowed. Never throws.
 */
export async function registerPushDevice(): Promise<string | null> {
  try {
    await ensureChannels();
    if ((await getPushPermission()) !== 'granted') return null;
    const token = await expoToken();
    if (!token) return null;
    await devices.register({
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      app: 'driver',
      locale: 'uz',
    });
    currentToken = token;
    return token;
  } catch (error) {
    console.warn('[push] registration failed', error);
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** Before signing out: this phone stops receiving the account's pushes. Best effort. */
export async function unregisterPushDevice(): Promise<void> {
  try {
    const token =
      currentToken ??
      ((await getPushPermission()) === 'granted' ? await withTimeout(expoToken(), 3_000) : null);
    if (!token) return;
    await withTimeout(devices.unregister(token), 5_000);
    currentToken = null;
  } catch (error) {
    console.warn('[push] unregister failed', error);
  }
}

export async function pushIntroSeen(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(INTRO_SEEN_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markPushIntroSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(INTRO_SEEN_KEY, '1');
  } catch {
    // shown again next time: harmless
  }
}
