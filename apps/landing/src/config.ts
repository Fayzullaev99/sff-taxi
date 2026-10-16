/**
 * Site configuration, compiled in from VITE_* variables (apps/landing/.env.example lists
 * them). Everything has a safe placeholder so the site builds and runs before the founder
 * fills in the store links, the phone and the legal entity. `buildConfig` is pure so the
 * build (vite.config.ts) and the pages read the same values.
 */

export type EnvLike = Record<string, string | undefined>;

export function buildConfig(env: EnvLike) {
  const read = (name: string, fallback = ''): string => {
    const v = env[name];
    return v === undefined || v === '' ? fallback : v;
  };
  return {
    /** Public origin of this site (canonical URLs, Open Graph, sitemap). */
    siteUrl: read('VITE_SITE_URL', 'https://taxi.sff.uz').replace(/\/+$/, ''),
    /**
     * API origin. Empty (the default) means the same origin: the production Caddy proxies
     * /v1/* on the landing domain to the API, like the operator panel's.
     */
    apiUrl: read('VITE_API_URL', '').replace(/\/+$/, ''),
    androidPackage: read('VITE_ANDROID_PACKAGE', 'uz.sff.taxi'),
    androidDriverPackage: read('VITE_ANDROID_DRIVER_PACKAGE', 'uz.sff.taxi.driver'),
    /** Store pages; an empty App Store link shows "soon" instead of a dead button. */
    playRider: read('VITE_PLAY_RIDER', 'https://play.google.com/store/apps/details?id=uz.sff.taxi'),
    appStoreRider: read('VITE_APPSTORE_RIDER', ''),
    playDriver: read(
      'VITE_PLAY_DRIVER',
      'https://play.google.com/store/apps/details?id=uz.sff.taxi.driver',
    ),
    appStoreDriver: read('VITE_APPSTORE_DRIVER', ''),
    /** Operator (dispatch office) phone, E.164; shown formatted. */
    supportPhone: read('VITE_SUPPORT_PHONE', '+998XXXXXXXXX'),
    supportTelegram: read('VITE_SUPPORT_TELEGRAM', ''),
    officeAddress: read('VITE_OFFICE_ADDRESS', 'Guliston sh., [ko‘cha, uy]'),
    /** Legal entity, as on the registration certificate: placeholders until filled. */
    legalName: read('VITE_LEGAL_NAME', '[«SFF TAXI» MChJ]'),
    inn: read('VITE_INN', '[XXX XXX XXX]'),
    legalEmail: read('VITE_LEGAL_EMAIL', 'info@sff.uz'),
    /**
     * Analytics: a script URL (Plausible, Yandex Metrika loader, …) to load after the page.
     * Empty by default: no tracking at all (see analytics.ts).
     */
    analyticsSrc: read('VITE_ANALYTICS_SRC', ''),
    analyticsSite: read('VITE_ANALYTICS_SITE', ''),
    /** Tiles of the share-trip map; tile.openstreetmap.org is for low traffic only. */
    mapTileUrl: read('VITE_MAP_TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
    mapAttribution: read('VITE_MAP_ATTRIBUTION', '© OpenStreetMap contributors'),
    /** The launch promo code the pages advertise. */
    launchPromoCode: read('VITE_LAUNCH_PROMO_CODE', 'GULISTON'),
    /** The rider app's deep-link scheme (apps/rider/app.config.ts `scheme`). */
    appScheme: 'sfftaxi',
  };
}

export type SiteConfig = ReturnType<typeof buildConfig>;

// `import.meta.env` is undefined when vite.config.ts imports this file under Node
export const config: SiteConfig = buildConfig((import.meta.env ?? {}) as EnvLike);

/** +998901234567 -> +998 90 123 45 67; placeholders pass through unchanged. */
export function formatPhone(phone: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone.replace(/[\s-]/g, ''));
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/** Whether a phone is a real number (not the placeholder). */
export const isPhone = (phone: string) => /^\+998\d{9}$/.test(phone.replace(/[\s-]/g, ''));

/** Whether a store link is a real page (not a placeholder, not empty). */
export const isLink = (url: string) => /^https:\/\//.test(url) && !/REPLACE|XXX/.test(url);
