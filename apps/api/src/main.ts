import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ENV, type Env, loadEnv } from './config/env.js';
import { initErrorReporting } from './core/observability/sentry.js';

initErrorReporting(loadEnv(), 'api');
const app = configureApp(await NestFactory.create(AppModule, { bufferLogs: true }));
await app.listen(app.get<Env>(ENV).PORT);
