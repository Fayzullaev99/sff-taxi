import { type ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import pg from 'pg';
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

/** node-postgres' error when no pooled connection frees up within connectionTimeoutMillis. */
function isPoolTimeout(error: unknown): boolean {
  return error instanceof Error && /timeout exceeded when trying to connect/i.test(error.message);
}

/**
 * The single global filter:
 * - expected Postgres errors (constraints, lock conflicts, timeouts) become 4xx/503
 *   instead of 500s;
 * - HTTP exceptions pass through unchanged;
 * - anything else is an unexpected failure: logged, reported, answered as 500.
 */
@Catch()
export class AppExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  override catch(error: unknown, host: ArgumentsHost): void {
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
          message: mapped.message,
          ...(db?.constraint ? { constraint: db.constraint } : {}),
        });
      return;
    }
    if (!(error instanceof HttpException) || error.getStatus() >= 500) {
      const req = host.switchToHttp().getRequest<Request>();
      reportError(error, { method: req.method, route: req.route?.path ?? req.path });
    }
    // exceptions built from msg() carry { message, key, params } only: give every error body
    // the same statusCode/error fields the apps read
    if (error instanceof HttpException) {
      const body = error.getResponse();
      if (typeof body === 'object' && body !== null && !('statusCode' in body)) {
        const status = error.getStatus();
        host
          .switchToHttp()
          .getResponse<Response>()
          .status(status)
          .json({ statusCode: status, error: HttpStatus[status] ?? 'Error', ...body });
        return;
      }
    }
    super.catch(error, host);
  }
}
