import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';

/**
 * The time business rules read: the night add-on of a fare, the Tashkent day, week and month
 * of the commission caps, the launch promo and the tax period. In production it is the real
 * time. Tests pin it (TEST_CALENDAR_AT, or pin()) so fares and caps do not depend on the hour
 * or the date the suite runs at.
 *
 * Only the *reading* of time goes through it: timestamps stored in the database and every
 * deadline (quote validity, offers, payment windows) stay real, so SQL now() and the app
 * agree. A pinned calendar is a constant shift: real instant t reads as t + shift.
 */
@Injectable()
export class BusinessCalendar {
  private shiftMs = 0;

  constructor(@Inject(ENV) env: Env) {
    if (env.TEST_CALENDAR_AT) this.pin(new Date(env.TEST_CALENDAR_AT));
  }

  /** What business rules see for the real instant `t` (default: now). */
  at(t: Date = new Date()): Date {
    return new Date(t.getTime() + this.shiftMs);
  }

  /** The real instant a business-calendar instant corresponds to (bounds for SQL on stored times). */
  real(calendarTime: Date): Date {
    return new Date(calendarTime.getTime() - this.shiftMs);
  }

  /** Tests: from now on, the current moment reads as `at` (null: the real time again). */
  pin(at: Date | null): void {
    this.shiftMs = at ? at.getTime() - Date.now() : 0;
  }
}

@Global()
@Module({ providers: [BusinessCalendar], exports: [BusinessCalendar] })
export class CalendarModule {}
