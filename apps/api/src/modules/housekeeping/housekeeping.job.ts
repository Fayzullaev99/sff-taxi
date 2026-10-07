import { Injectable } from '@nestjs/common';
import { Database } from '../../core/db/database.js';
import { PeriodicJob } from '../../core/jobs/periodic-job.js';
import { OUTBOX_RETENTION_DAYS, purgeProcessedOutbox } from '../../core/outbox/outbox.js';
import { IntercityService } from '../intercity/intercity.service.js';
import { IntentsService } from '../payments/intents.service.js';
import { RidesService } from '../rides/rides.service.js';
import { UploadsService } from '../uploads/uploads.service.js';

/**
 * Deadlines nobody else enforces, run by the worker: card rides, top-ups and booking deposits
 * not paid in time, uploads started and never completed. Safe with several workers (rows are re-checked and
 * locked with SKIP LOCKED).
 */
@Injectable()
export class HousekeepingJob extends PeriodicJob {
  protected readonly intervalMs = 30_000;

  constructor(
    private readonly rides: RidesService,
    private readonly intents: IntentsService,
    private readonly uploads: UploadsService,
    private readonly intercity: IntercityService,
    private readonly db: Database,
  ) {
    super();
  }

  async runOnce(now = new Date()) {
    const unpaidRides = await this.rides.expireUnpaid(now);
    const unpaidTopups = await this.intents.expireTopups(now);
    const unpaidBookings = await this.intercity.expireUnpaidBookings(now);
    const uploads = await this.uploads.removeAbandoned(100, now);
    // the outbox only grows otherwise (tens of events per ride): a batch per run
    const outbox = await purgeProcessedOutbox(
      this.db.kysely,
      new Date(now.getTime() - OUTBOX_RETENTION_DAYS * 86_400_000),
    );
    if (unpaidRides || unpaidTopups || unpaidBookings || uploads || outbox) {
      this.logger.log(
        `Expired ${unpaidRides} unpaid ride(s), ${unpaidTopups} top-up(s), ${unpaidBookings} booking(s); removed ${uploads} upload(s), ${outbox} old outbox event(s)`,
      );
    }
    return { unpaidRides, unpaidTopups, unpaidBookings, uploads, outbox };
  }
}
