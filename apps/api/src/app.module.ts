import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { AuthModule } from './core/auth/auth.module.js';
import { DatabaseModule } from './core/db/database.js';
import { RateLimitInterceptor } from './core/http/rate-limit.js';
import { MetricsModule } from './core/observability/metrics.module.js';
import { OutboxAdminModule } from './core/outbox/outbox-admin.module.js';
import { RedisModule } from './core/redis/redis.module.js';
import { SmsModule } from './core/sms/sms.module.js';
import { HealthController } from './health/health.controller.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { DispatchModule } from './modules/dispatch/dispatch.module.js';
import { DriversModule } from './modules/drivers/drivers.module.js';
import { GeoModule } from './modules/geo/geo.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { RidesModule } from './modules/rides/rides.module.js';
import { SafetyModule } from './modules/safety/safety.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';

/**
 * Request log fields that carry credentials: bearer tokens and Payme's Basic auth (our
 * merchant key), cookies, and personal data some older panels may put in query strings.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.query.phone',
  'req.query.ticket',
];

/**
 * URL parts that never reach the logs (pino-http logs the URL in full): share-trip tokens
 * let anyone follow a ride live, stream tickets open a user's event stream, phones are
 * personal data.
 */
const SENSITIVE_URL: [RegExp, string][] = [
  [/(\/share\/)[^/?#]+/gi, '$1[Redacted]'],
  [/([?&](?:phone|ticket)=)[^&#]*/gi, '$1[Redacted]'],
];

export function redactUrl(url: string): string {
  return SENSITIVE_URL.reduce((u, [pattern, replacement]) => u.replace(pattern, replacement), url);
}

/** pino-http request serializer (applied to the standard one): masks sensitive URL parts. */
export function logRequest<T extends { url?: unknown }>(req: T): T {
  if (typeof req.url === 'string') req.url = redactUrl(req.url);
  return req;
}

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          redact: LOG_REDACT_PATHS,
          serializers: { req: logRequest },
          ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
        },
      }),
    }),
    MetricsModule,
    DatabaseModule,
    RedisModule,
    SmsModule,
    AuthModule,
    SettingsModule,
    GeoModule,
    BillingModule,
    DriversModule,
    RidesModule,
    DispatchModule,
    SafetyModule,
    RealtimeModule,
    NotificationsModule,
    OutboxAdminModule,
    UploadsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor }],
})
export class AppModule {}
