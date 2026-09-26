import { type ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import pg from 'pg';
import { reportError } from '../observability/sentry.js';

// https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_ERROR_STATUS: Record<string, { status: HttpStatus; message: string }> = {
  '23505': { status: HttpStatus.CONFLICT, message: 'Bunday yozuv allaqachon bor' },
  '23503': { status: HttpStatus.CONFLICT, message: 'Bog‘langan yozuv topilmadi' },
  '23514': { status: HttpStatus.BAD_REQUEST, message: 'Qiymat qoidaga mos emas' },
  // exclusion constraint: e.g. two bookings of one table at overlapping times
  '23P01': { status: HttpStatus.CONFLICT, message: 'Vaqt boshqa yozuv bilan to‘qnashadi' },
  '22P02': { status: HttpStatus.BAD_REQUEST, message: 'Noto‘g‘ri qiymat' },
};

/**
 * The single global filter:
 * - expected Postgres constraint errors become 4xx instead of 500s;
 * - HTTP exceptions pass through unchanged;
 * - anything else is an unexpected failure: logged, reported, answered as 500.
 */
@Catch()
export class AppExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  override catch(error: unknown, host: ArgumentsHost): void {
    if (error instanceof pg.DatabaseError && error.code && PG_ERROR_STATUS[error.code]) {
      const mapped = PG_ERROR_STATUS[error.code]!;
      this.logger.warn(`${error.code} ${error.constraint ?? ''}: ${error.message}`);
      host
        .switchToHttp()
        .getResponse<Response>()
        .status(mapped.status)
        .json({ statusCode: mapped.status, message: mapped.message, constraint: error.constraint });
      return;
    }
    if (!(error instanceof HttpException) || error.getStatus() >= 500) {
      const req = host.switchToHttp().getRequest<Request>();
      reportError(error, { method: req.method, route: req.route?.path ?? req.path });
    }
    super.catch(error, host);
  }
}
