import * as Sentry from '@sentry/node';
import type { Env } from '../../config/env.js';

let enabled = false;

/** No-op unless SENTRY_DSN is set. Call once at process start. */
export function initErrorReporting(env: Env, service: 'api' | 'worker'): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.APP_RELEASE,
    initialScope: { tags: { service } },
    tracesSampleRate: 0,
    // Errors only. Requests carry phone numbers, passwords, OTP codes and tokens, and
    // local variables can hold them too, so none of that leaves the server.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
  });
  enabled = true;
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export async function flushErrorReports(): Promise<void> {
  if (enabled) await Sentry.flush(2000);
}
