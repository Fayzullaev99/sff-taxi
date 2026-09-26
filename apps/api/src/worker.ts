import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadEnv } from './config/env.js';
import { initErrorReporting } from './core/observability/sentry.js';
import { WorkerModule } from './worker.module.js';
import { WorkerRuntime } from './worker-runtime.js';

initErrorReporting(loadEnv(), 'worker');
const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
// SIGTERM/SIGINT: finish the current batch, then close pools
app.enableShutdownHooks();
await app.get(WorkerRuntime).start();
