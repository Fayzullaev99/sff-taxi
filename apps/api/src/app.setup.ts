import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import type { Histogram } from 'prom-client';
import { ENV, type Env } from './config/env.js';
import { AppExceptionFilter } from './core/http/app-exception.filter.js';
import { useUzbekValidationMessages } from './core/http/messages.js';
import { HTTP_DURATION, httpMetrics } from './core/observability/metrics.module.js';

/** Shared by main.ts and the tests, so tests exercise the same HTTP pipeline as production. */
export function configureApp(app: INestApplication): INestApplication {
  useUzbekValidationMessages();
  const express = app as NestExpressApplication;
  app.useLogger(app.get(Logger));
  // req.ip must be the client, not the proxy: rate limits key on it
  express.set('trust proxy', app.get<Env>(ENV).TRUST_PROXY_HOPS);
  express.disable('x-powered-by');
  // bearer tokens, no cookies: credentials stay off. Mobile apps send no Origin.
  app.enableCors({
    origin: app.get<Env>(ENV).CORS_ORIGINS,
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  app.use(httpMetrics(app.get<Histogram<'method' | 'route' | 'status'>>(HTTP_DURATION)));
  app.setGlobalPrefix('v1', { exclude: ['health', 'metrics'] });
  app.useGlobalFilters(new AppExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();
  return app;
}
