import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { DatabaseModule } from './core/db/database.js';
import { createRegistry } from './core/observability/metrics.js';
import { OutboxDispatcher, WORKER_METRICS } from './core/outbox/dispatcher.js';
import { OUTBOX_HANDLERS, type OutboxHandler } from './core/outbox/handler.js';
import { RedisModule } from './core/redis/redis.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
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
    SettingsModule,
  ],
  providers: [
    {
      provide: OUTBOX_HANDLERS,
      inject: [],
      useFactory: (...handlers: OutboxHandler[]) => handlers,
    },
    { provide: WORKER_METRICS, useFactory: () => createRegistry('worker') },
    OutboxDispatcher,
    WorkerRuntime,
  ],
})
export class WorkerModule {}
