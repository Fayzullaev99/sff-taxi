import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { AuthModule } from './core/auth/auth.module.js';
import { DatabaseModule } from './core/db/database.js';
import { MetricsModule } from './core/observability/metrics.module.js';
import { RedisModule } from './core/redis/redis.module.js';
import { SmsModule } from './core/sms/sms.module.js';
import { HealthController } from './health/health.controller.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { DriversModule } from './modules/drivers/drivers.module.js';
import { GeoModule } from './modules/geo/geo.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
