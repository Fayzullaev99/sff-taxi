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

/**
 * The landing site (apps/landing): https://<domain>/invite/CODE and /promo/CODE open in the
 * app as app links (Android App Links / iOS Universal Links). The site must serve
 * /.well-known/assetlinks.json with the signing fingerprint and apple-app-site-association
 * with the team id, else the links open in the browser, which still shows the code.
 */
const LANDING_DOMAIN = process.env.EXPO_PUBLIC_LANDING_DOMAIN || 'taxi.sff.uz';

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
  description: 'Guliston taksisi: qat’iy narx, surge yo‘q. Naqd yoki karta.',
  // iOS permission texts and the display name per language (InfoPlist.strings)
  locales: { uz: './locales/uz.json', ru: './locales/ru.json' },
  ios: {
    bundleIdentifier: 'uz.sff.taxi',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_REASON,
      // only HTTPS and standard crypto: no export-compliance questions on each upload
      ITSAppUsesNonExemptEncryption: false,
    },
    // universal links from the landing site (invitations, promo codes)
    associatedDomains: [`applinks:${LANDING_DOMAIN}`],
    ...(googleMapsApiKey ? { config: { googleMapsApiKey } } : {}),
  },
  android: {
    package: 'uz.sff.taxi',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: BRAND,
    },
    // app links from the landing site: https://<domain>/invite/CODE and /promo/CODE
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: LANDING_DOMAIN, pathPrefix: '/invite/' },
          { scheme: 'https', host: LANDING_DOMAIN, pathPrefix: '/promo/' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'POST_NOTIFICATIONS',
      // complaint photos; the gallery goes through the system photo picker (no storage)
      'CAMERA',
    ],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    predictiveBackGestureEnabled: false,
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
  extra: {
    ...config.extra,
    // without a key the Android Google Maps SDK crashes on the first MapView: map-less fallbacks
    androidMapsKey: Boolean(googleMapsApiKey),
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-location', { locationWhenInUsePermission: LOCATION_REASON }],
    ['react-native-maps', googleMapsApiKey ? { androidGoogleMapsApiKey: googleMapsApiKey } : {}],
    // Payme / Click checkout pages for card rides open in an in-app browser tab
    'expo-web-browser',
    // release APKs pointed at an http:// API (emulator, LAN) need cleartext traffic
    './plugins/with-cleartext-http-api',
    // photos for a complaint (a lost bag, a dirty seat): camera or gallery
    [
      'expo-image-picker',
      {
        photosPermission: 'Shikoyatga rasm qo‘shish uchun galereyadan tanlash.',
        cameraPermission: 'Shikoyatga rasm qo‘shish uchun suratga olish.',
        microphonePermission: false,
      },
    ],
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
