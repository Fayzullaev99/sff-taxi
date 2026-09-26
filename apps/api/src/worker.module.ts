import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { DatabaseModule } from './core/db/database.js';
import { createRegistry } from './core/observability/metrics.js';
import { OutboxDispatcher, WORKER_METRICS } from './core/outbox/dispatcher.js';
import { OUTBOX_HANDLERS, type OutboxHandler } from './core/outbox/handler.js';
import { RedisModule } from './core/redis/redis.module.js';
import { SmsModule } from './core/sms/sms.module.js';
import { DispatchHandler } from './modules/dispatch/dispatch.handler.js';
import { DispatchModule } from './modules/dispatch/dispatch.module.js';
import { NotificationsHandler } from './modules/notifications/notifications.handler.js';
import { NotificationsWorkerModule } from './modules/notifications/notifications.module.js';
import { RealtimePublisher } from './modules/realtime/realtime.publisher.js';
import { HousekeepingJob } from './modules/housekeeping/housekeeping.job.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';
import { WorkerRuntime } from './worker-runtime.js';

/** The worker process: outbox dispatching and its handlers, periodic jobs, no HTTP API. */
@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
        },
      }),
    }),
    DatabaseModule,
    RedisModule,
    SmsModule,
    SettingsModule,
    UploadsModule,
    DispatchModule,
    NotificationsWorkerModule,
  ],
  providers: [
    RealtimePublisher,
    {
      provide: OUTBOX_HANDLERS,
      inject: [DispatchHandler, RealtimePublisher, NotificationsHandler],
      useFactory: (...handlers: OutboxHandler[]) => handlers,
    },
    { provide: WORKER_METRICS, useFactory: () => createRegistry('worker') },
    OutboxDispatcher,
    HousekeepingJob,
    WorkerRuntime,
  ],
})
export class WorkerModule {}
