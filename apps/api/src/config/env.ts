import { z } from 'zod';

const list = (item: z.ZodType<string, string>) =>
  z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item));

const bool = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3200),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Web panel origins allowed to call the API from a browser, comma-separated. */
    CORS_ORIGINS: list(z.url()).default(['http://localhost:5280']),
    /** Number of reverse proxies in front of the API (nginx, load balancer); 0 = direct. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    /** Connections per API instance. */
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** A single query may not hold a connection longer than this (0 = no limit). */
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    /** How long a request waits for a free pooled connection before answering 503 (0 = forever). */
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    /** How long a statement waits for a row or table lock before answering 409 (0 = forever). */
    DB_LOCK_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),
    /** A transaction left idle this long is ended by Postgres, releasing its locks (0 = never). */
    DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(60_000),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(60),

    /** Phones (E.164) that become platform operators (dispatchers) when they sign in. */
    ADMIN_PHONES: list(z.string().regex(/^\+998\d{9}$/, 'E.164, e.g. +998901234567')),

    // SMS ------------------------------------------------------------------
    SMS_PROVIDER: z.enum(['eskiz', 'playmobile', 'console']),
    /** Must match the template approved by the SMS provider. {code} is replaced. */
    SMS_OTP_TEMPLATE: z
      .string()
      .includes('{code}')
      .default('SFF Taxi: tasdiqlash kodi {code}. Kodni hech kimga bermang.'),
    ESKIZ_BASE_URL: z.url().default('https://notify.eskiz.uz'),
    ESKIZ_EMAIL: z.string().optional(),
    ESKIZ_PASSWORD: z.string().optional(),
    ESKIZ_FROM: z.string().default('4546'),
    PLAYMOBILE_BASE_URL: z.url().optional(),
    PLAYMOBILE_USERNAME: z.string().optional(),
    PLAYMOBILE_PASSWORD: z.string().optional(),
    PLAYMOBILE_ORIGINATOR: z.string().default('3700'),

    // OTP ------------------------------------------------------------------
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    /**
     * Store-review accounts: "phone:code" pairs that sign in with a fixed code and
     * no SMS (App Store / Google Play reviewers cannot receive our SMS).
     */
    OTP_FIXED_CODES: list(z.string().regex(/^\+998\d{9}:\d{6}$/, '+998XXXXXXXXX:123456')),

    /** IP-keyed limits are multiplied by this (tests run from one IP). */
    RATE_LIMIT_IP_MULTIPLIER: z.coerce.number().min(1).max(1000).default(1),

    // Card payments (docs/payments.md): rides prepaid by card, driver top-ups ---------
    /** The platform's Payme merchant (cabinet → "ID кассы") and its key for the Merchant API. */
    PAYME_MERCHANT_ID: z
      .string()
      .regex(/^[0-9a-f]{24}$/, '24 hex characters')
      .optional(),
    PAYME_KEY: z.string().min(8).optional(),
    /** The platform's Click service, merchant and secret key for the SHOP API. */
    CLICK_SERVICE_ID: z.string().regex(/^\d+$/, 'digits').optional(),
    CLICK_MERCHANT_ID: z.string().regex(/^\d+$/, 'digits').optional(),
    CLICK_SECRET: z.string().min(8).optional(),
    /** Payme's sandbox checkout (checkout.test.paycom.uz) instead of the real one. */
    PAYME_TEST: bool('false'),
    /**
     * Where the provider's page sends the payer back: the app's deep link or a web page.
     * "{intentId}" is replaced with the payment's id. Unset = the providers' default page.
     */
    PAYMENT_RETURN_URL: z.string().min(8).max(500).optional(),

    // Uploads (S3-compatible, private bucket; all or none: uploads answer 503 until set) -------
    /** Omit for AWS S3; set for any other S3-compatible service (SeaweedFS, MinIO...). */
    STORAGE_S3_ENDPOINT: z.url().optional(),
    /** Endpoint the apps PUT to and read from, when it differs from the one the API reaches. */
    STORAGE_S3_PUBLIC_ENDPOINT: z.url().optional(),
    STORAGE_S3_REGION: z.string().min(1).default('us-east-1'),
    STORAGE_S3_BUCKET: z.string().min(3).max(63).optional(),
    STORAGE_S3_ACCESS_KEY: z.string().min(1).optional(),
    STORAGE_S3_SECRET_KEY: z.string().min(1).optional(),

    // Geography (docs/architecture.md) ------------------------------------------
    /** Address search and reverse geocoding; yandex falls back to nominatim when that is configured too. */
    GEOCODER: z.enum(['yandex', 'nominatim', 'none']).default('none'),
    YANDEX_GEOCODER_KEY: z.string().min(10).optional(),
    YANDEX_GEOCODER_URL: z.url().default('https://geocode-maps.yandex.ru/1.x/'),
    NOMINATIM_URL: z.url().default('https://nominatim.openstreetmap.org'),
    /** Nominatim's usage policy wants a contact in the User-Agent; also enables it as a fallback. */
    GEOCODER_CONTACT_EMAIL: z.email().optional(),
    /** Address searches one IP may make per minute. */
    GEOCODER_IP_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(30),
    /** Road distances: osrm (self-hosted, OSRM_URL) or none (straight line × detour factor). */
    ROUTER: z.enum(['osrm', 'none']).default('none'),
    OSRM_URL: z.url().optional(),
    ROUTER_DETOUR_FACTOR: z.coerce.number().min(1).max(3).default(1.35),
    ROUTER_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1500),
    /** Yandex Maps JavaScript API key handed to the apps; without it they use OSM tiles. */
    YANDEX_MAPS_JS_KEY: z.string().min(10).optional(),
    MAP_TILE_URL: z.string().default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
    MAP_TILE_ATTRIBUTION: z.string().default('© OpenStreetMap contributors'),

    // Worker -------------------------------------------------------------------
    WORKER_HTTP_PORT: z.coerce.number().int().positive().default(3201),
    /** How often the dispatcher looks at waiting rides and expiring offers. */
    DISPATCH_TICK_MS: z.coerce.number().int().min(200).max(60_000).default(1000),

    // Apps' configuration (GET /v1/config) ------------------------------------------------
    /** The operators' phone line riders and drivers call (E.164). */
    SUPPORT_PHONE: z
      .string()
      .regex(/^\+998\d{9}$/, 'E.164, e.g. +998901234567')
      .optional(),
    /** Support in Telegram: @username or https://t.me/... */
    SUPPORT_TELEGRAM: z.string().min(2).max(100).optional(),
    /** The office where drivers top up in cash and bring documents. */
    OFFICE_ADDRESS: z.string().min(5).max(300).optional(),
    /** Older app versions are asked to update (semver). */
    MIN_RIDER_APP_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'x.y.z')
      .default('1.0.0'),
    MIN_DRIVER_APP_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'x.y.z')
      .default('1.0.0'),

    /** Public origin of the page that opens share-trip links: {origin}/t/{token}. */
    SHARE_BASE_URL: z.url().default('https://taxi.sff.uz'),

    // Notifications ----------------------------------------------------------------
    /** expo: Expo push service; console: log only. Default: expo in production, console otherwise. */
    PUSH_PROVIDER: z.enum(['expo', 'console']).optional(),
    /** Expo access token, required only when "Enhanced push security" is on for the project. */
    EXPO_ACCESS_TOKEN: z.string().min(10).optional(),
    /** Expo push API; {base}/send and {base}/getReceipts. Tests point it at a fake server. */
    EXPO_PUSH_BASE_URL: z.url().default('https://exp.host/--/api/v2/push'),
    /** SMS to riders who ordered by phone (no app): car, plate and arrival. Costs money. */
    NOTIFY_SMS_PHONE_ORDERS: bool('true'),

    /**
     * Tests only: the instant the business calendar (night add-on, commission day/week, tax
     * month, promo) reads as "now" when the process starts. Refused in production.
     */
    TEST_CALENDAR_AT: z.iso.datetime({ offset: true }).optional(),

    // Observability ------------------------------------------------------------
    METRICS_TOKEN: z.string().min(16).optional(),
    SENTRY_DSN: z.url().optional(),
    APP_RELEASE: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const require = (keys: (keyof typeof env)[], reason: string) => {
      for (const key of keys) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `Required ${reason}` });
      }
    };
    if (env.SMS_PROVIDER === 'eskiz') require(['ESKIZ_EMAIL', 'ESKIZ_PASSWORD'], 'for Eskiz');
    if (env.SMS_PROVIDER === 'playmobile') {
      require([
        'PLAYMOBILE_BASE_URL',
        'PLAYMOBILE_USERNAME',
        'PLAYMOBILE_PASSWORD',
      ], 'for Play Mobile');
    }
    // half a provider is a typo, not a choice: say so instead of silently not offering it
    if (env.PAYME_MERCHANT_ID || env.PAYME_KEY) {
      require(['PAYME_MERCHANT_ID', 'PAYME_KEY'], 'for Payme');
    }
    if (env.CLICK_SERVICE_ID || env.CLICK_MERCHANT_ID || env.CLICK_SECRET) {
      require(['CLICK_SERVICE_ID', 'CLICK_MERCHANT_ID', 'CLICK_SECRET'], 'for Click');
    }
    const storage = [
      'STORAGE_S3_BUCKET',
      'STORAGE_S3_ACCESS_KEY',
      'STORAGE_S3_SECRET_KEY',
    ] as const;
    if (storage.some((key) => env[key])) require([...storage], 'for uploads');
    if (env.GEOCODER === 'yandex') require(['YANDEX_GEOCODER_KEY'], 'for GEOCODER=yandex');
    if (env.GEOCODER === 'nominatim') {
      require(['GEOCODER_CONTACT_EMAIL'], 'for GEOCODER=nominatim (usage policy)');
    }
    if (env.ROUTER === 'osrm') require(['OSRM_URL'], 'for ROUTER=osrm');
    if (env.NODE_ENV === 'production' && env.TEST_CALENDAR_AT) {
      ctx.addIssue({
        code: 'custom',
        path: ['TEST_CALENDAR_AT'],
        message: 'a pinned business calendar is for tests only',
      });
    }
    // /metrics lists routes, error rates and queue sizes: never open in production
    if (env.NODE_ENV === 'production') require(['METRICS_TOKEN'], 'in production');
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'console provider does not deliver SMS and is not allowed in production',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Injection token for the validated environment. */
export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // "KEY=" in an env file means "not set", not "set to empty string"
  const defined = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = EnvSchema.safeParse(defined);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
