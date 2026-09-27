import type { ConfigContext, ExpoConfig } from 'expo/config';

/** SFF Taxi yellow (distinct from SFF Eats' red), always with near-black #111 text. */
const BRAND = '#FFC400';

/** Google Maps needs a key on Android builds; Expo Go works without one. */
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Expo push tokens belong to an EAS project (`eas init` prints its id). Without one the
 * app runs normally and simply registers no push token.
 */
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined;

/** Firebase config for FCM on Android builds; optional in dev. */
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || undefined;

const LOCATION_REASON =
  'Taksi sizni qayerdan olib ketishini aniqlash va haydovchiga ko‘rsatish uchun';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'SFF Taxi',
  slug: 'sff-taxi',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'sfftaxi',
  userInterfaceStyle: 'light',
  backgroundColor: '#ffffff',
  primaryColor: BRAND,
  ios: {
    bundleIdentifier: 'uz.sff.taxi',
    supportsTablet: false,
    infoPlist: { NSLocationWhenInUseUsageDescription: LOCATION_REASON },
    ...(googleMapsApiKey ? { config: { googleMapsApiKey } } : {}),
  },
  android: {
    package: 'uz.sff.taxi',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: BRAND,
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS'],
    predictiveBackGestureEnabled: false,
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
  extra: {
    ...config.extra,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-location', { locationWhenInUsePermission: LOCATION_REASON }],
    ['react-native-maps', googleMapsApiKey ? { androidGoogleMapsApiKey: googleMapsApiKey } : {}],
    // Payme / Click checkout pages for card rides open in an in-app browser tab
    'expo-web-browser',
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: BRAND,
        // the API sends ride pushes on this channel (apps/api notifier: channelId 'rides')
        defaultChannel: 'rides',
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: BRAND,
        image: './assets/splash-icon.png',
        imageWidth: 120,
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
});
