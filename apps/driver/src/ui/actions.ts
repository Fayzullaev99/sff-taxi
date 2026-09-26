import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { Alert, Platform } from 'react-native';
import type { Point } from '../lib/geo';
import { NAV_APPS, type NavApp, navigationLinks, phoneLink } from '../lib/links';

const NAV_APP_KEY = 'sff.taxi.driver.navApp';

export async function getPreferredNavApp(): Promise<NavApp | null> {
  try {
    const v = await SecureStore.getItemAsync(NAV_APP_KEY);
    return NAV_APPS.some((a) => a.app === v) ? (v as NavApp) : null;
  } catch {
    return null;
  }
}

export async function setPreferredNavApp(app: NavApp | null): Promise<void> {
  try {
    if (app) await SecureStore.setItemAsync(NAV_APP_KEY, app);
    else await SecureStore.deleteItemAsync(NAV_APP_KEY);
  } catch {
    // asked again next time: harmless
  }
}

async function openNavApp(app: NavApp, to: Point): Promise<void> {
  const links = navigationLinks(app, to, 'car', Platform.OS === 'ios' ? 'ios' : 'android');
  try {
    await Linking.openURL(links.app);
  } catch {
    // the app is not installed: the route opens in the browser instead
    try {
      await Linking.openURL(links.web);
    } catch {
      Alert.alert('Xaritani ochib bo‘lmadi', 'Telefoningizda xarita ilovasi topilmadi.');
    }
  }
}

/**
 * Starts turn-by-turn navigation to `to` in the driver's navigator: one tap once a
 * navigator was chosen (Sozlamalar can change it), otherwise asks and remembers.
 */
export async function navigateTo(to: Point, title: string): Promise<void> {
  const preferred = await getPreferredNavApp();
  if (preferred) return openNavApp(preferred, to);
  Alert.alert(
    title,
    'Qaysi ilovada yo‘l ko‘rsatilsin? Tanlovingiz eslab qolinadi.',
    [
      ...NAV_APPS.map(({ app, label }) => ({
        text: label,
        onPress: () => {
          void setPreferredNavApp(app);
          void openNavApp(app, to);
        },
      })),
      // Android dialogs hold at most three buttons; there a tap outside cancels
      ...(Platform.OS === 'ios' ? [{ text: 'Bekor qilish', style: 'cancel' as const }] : []),
    ],
    { cancelable: true },
  );
}

export function call(phone: string | null | undefined): void {
  const url = phoneLink(phone);
  if (!url) {
    Alert.alert('Telefon raqami yo‘q');
    return;
  }
  Linking.openURL(url).catch(() => Alert.alert('Qo‘ng‘iroq qilib bo‘lmadi', phone ?? ''));
}
