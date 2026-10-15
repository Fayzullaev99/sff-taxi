import { type ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import pg from 'pg';
import { currentLanguage, type Language } from '../i18n/language.js';
import { translate, translateTemplate } from '../i18n/translate.js';
import { reportError } from '../observability/sentry.js';

const RETRY = 'Ma’lumot shu payt boshqa amal bilan o‘zgardi, qayta urinib ko‘ring';
const BUSY = 'Server hozir band, birozdan so‘ng qayta urinib ko‘ring';

// https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_ERROR_STATUS: Record<string, { status: HttpStatus; message: string }> = {
  '23505': { status: HttpStatus.CONFLICT, message: 'Bunday yozuv allaqachon bor' },
  '23503': { status: HttpStatus.CONFLICT, message: 'Bog‘langan yozuv topilmadi' },
  '23514': { status: HttpStatus.BAD_REQUEST, message: 'Qiymat qoidaga mos emas' },
  // exclusion constraint: e.g. two bookings of one table at overlapping times
  '23P01': { status: HttpStatus.CONFLICT, message: 'Vaqt boshqa yozuv bilan to‘qnashadi' },
  '22P02': { status: HttpStatus.BAD_REQUEST, message: 'Noto‘g‘ri qiymat' },
  // two requests changing the same rows at once: the loser may simply try again
  '40P01': { status: HttpStatus.CONFLICT, message: RETRY }, // deadlock_detected
  '40001': { status: HttpStatus.CONFLICT, message: RETRY }, // serialization_failure
  '55P03': { status: HttpStatus.CONFLICT, message: RETRY }, // lock_not_available (lock_timeout)
  // statement_timeout: the database is overloaded or the query is too heavy
  '57014': { status: HttpStatus.SERVICE_UNAVAILABLE, message: BUSY }, // query_canceled
};

/**
 * Nest's English defaults for exceptions thrown without a message (`new
 * UnauthorizedException()`), said in the person's language instead.
 */
const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Noto‘g‘ri so‘rov',
  401: 'Tizimga kiring',
  403: 'Ruxsat yo‘q',
  404: 'Topilmadi',
  409: 'Bajarib bo‘lmaydi',
  429: 'Juda ko‘p urinish',
  500: 'Tizim xatosi',
  503: BUSY,
};

/** node-postgres' error when no pooled connection frees up within connectionTimeoutMillis. */
function isPoolTimeout(error: unknown): boolean {
  return error instanceof Error && /timeout exceeded when trying to connect/i.test(error.message);
}

type ErrorBody = Record<string, unknown> & {
  message?: unknown;
  key?: unknown;
  params?: unknown;
  issues?: unknown;
};

/**
 * The body in the request's language. A message built by `msg()` carries its template
 * (`key`) and values, so the Russian template is rendered with the same values; any other
 * message, and every validation issue, is looked up as it is (templates match by shape).
 * `key` stays the Uzbek template: a client may key its own texts on it.
 */
export function localizeBody(body: ErrorBody, status: number, lang: Language): ErrorBody {
  const out: ErrorBody = { ...body };
  const message = out.message;
  if (typeof message === 'string') {
    if (NEST_DEFAULTS[message] && DEFAULT_MESSAGES[status]) {
      out.message = translate(DEFAULT_MESSAGES[status], lang);
    } else if (typeof out.key === 'string' && Array.isArray(out.params)) {
      out.message = translateTemplate(out.key, out.params as (string | number)[], lang);
    } else {
      out.message = translate(message, lang);
    }
  } else if (message === undefined && DEFAULT_MESSAGES[status]) {
    out.message = translate(DEFAULT_MESSAGES[status], lang);
  }
  if (Array.isArray(out.issues)) {
    out.issues = out.issues.map((issue: unknown) =>
      issue &&
      typeof issue === 'object' &&
      typeof (issue as { message?: unknown }).message === 'string'
        ? { ...issue, message: translate((issue as { message: string }).message, lang) }
        : issue,
    );
  }
  return out;
}

/** The exact English texts Nest puts in exceptions created without a message. */
const NEST_DEFAULTS: Record<string, true> = {
  'Bad Request': true,
  Unauthorized: true,
  Forbidden: true,
  'Not Found': true,
  Conflict: true,
  Gone: true,
  'Too Many Requests': true,
  'Unprocessable Entity': true,
  'Internal Server Error': true,
  'Service Unavailable': true,
};

/**
 * The single global filter:
 * - expected Postgres errors (constraints, lock conflicts, timeouts) become 4xx/503
 *   instead of 500s;
 * - HTTP exceptions pass through with their body, written in the request's language;
 * - anything else is an unexpected failure: logged, reported, answered as 500.
 */
@Catch()
export class AppExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  override catch(error: unknown, host: ArgumentsHost): void {
    const lang = currentLanguage();
    const mapped =
      error instanceof pg.DatabaseError && error.code
        ? PG_ERROR_STATUS[error.code]
        : isPoolTimeout(error)
          ? { status: HttpStatus.SERVICE_UNAVAILABLE, message: BUSY }
          : undefined;
    if (mapped) {
      const db = error instanceof pg.DatabaseError ? error : null;
      this.logger.warn(
        `${db?.code ?? 'pool'} ${db?.constraint ?? ''}: ${(error as Error).message}`,
      );
      if (mapped.status >= 500) reportError(error);
      host
        .switchToHttp()
        .getResponse<Response>()
        .status(mapped.status)
        .json({
          statusCode: mapped.status,
          message: translate(mapped.message, lang),
          ...(db?.constraint ? { constraint: db.constraint } : {}),
        });
      return;
    }
    if (!(error instanceof HttpException) || error.getStatus() >= 500) {
      const req = host.switchToHttp().getRequest<Request>();
      reportError(error, { method: req.method, route: req.route?.path ?? req.path });
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const raw = error.getResponse();
      // exceptions built from msg() carry { message, key, params } only: give every error
      // body the same statusCode/error fields the apps read
      const body: ErrorBody =
        typeof raw === 'object' && raw !== null
          ? { statusCode: status, error: HttpStatus[status] ?? 'Error', ...(raw as ErrorBody) }
          : { statusCode: status, error: HttpStatus[status] ?? 'Error', message: raw };
      host
        .switchToHttp()
        .getResponse<Response>()
        .status(status)
        .json(localizeBody(body, status, lang));
      return;
    }
    super.catch(error, host);
  }
}
