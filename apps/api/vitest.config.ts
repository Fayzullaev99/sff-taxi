import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const DB_HOST = process.env.TEST_DB_HOST ?? 'localhost:5460';
const REDIS_HOST = process.env.TEST_REDIS_HOST ?? 'localhost:6394';
// parallel checkouts (worktrees) each use their own database and Redis index
const DB_NAME = process.env.TEST_DB_NAME ?? 'taxi_test';
const REDIS_DB = process.env.TEST_REDIS_DB ?? '15';

const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: `postgres://taxi_app:taxi_app_dev@${DB_HOST}/${DB_NAME}`,
  DATABASE_MIGRATION_URL: `postgres://taxi_owner:taxi_owner_dev@${DB_HOST}/${DB_NAME}`,
  // flushed by global-setup: never point it at a development database
  REDIS_URL: `redis://${REDIS_HOST}/${REDIS_DB}`,
  JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  SMS_PROVIDER: 'console',
  ADMIN_PHONES: '+998900000001',
  OTP_FIXED_CODES: '+998900000099:123456,+998900000001:111111',
  // every test request comes from 127.0.0.1; phone-keyed limits stay at production values
  RATE_LIMIT_IP_MULTIPLIER: '1000',
  SHARE_BASE_URL: 'https://taxi.example.uz',
  // fares and commission caps read the business calendar: pin it to a daytime Wednesday
  // during the launch promo, so the suite passes at any hour and on any date
  TEST_CALENDAR_AT: '2026-10-14T12:00:00+05:00',
  // card payments (test/payments.test.ts): sandbox checkout, made-up credentials
  PAYME_MERCHANT_ID: '5e730e8e0b852a417aa49ceb',
  PAYME_KEY: 'test-payme-merchant-key',
  PAYME_TEST: 'true',
  CLICK_SERVICE_ID: '12345',
  CLICK_MERCHANT_ID: '999',
  CLICK_SECRET: 'test-click-secret-key',
  PAYMENT_RETURN_URL: 'sfftaxi://payments/{intentId}',
};
// globalSetup runs in this process, not in a test worker, so it reads process.env directly
Object.assign(process.env, testEnv);

export default defineConfig({
  // SWC instead of esbuild: Nest's dependency injection needs emitDecoratorMetadata
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // test files share one database; run them one at a time
    fileParallelism: false,
    testTimeout: 20_000,
    // building the app imports the AWS SDK: slow on a cold Windows file cache
    hookTimeout: 60_000,
    env: testEnv,
  },
});
