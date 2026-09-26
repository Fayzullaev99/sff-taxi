import { Injectable } from '@nestjs/common';
import { PeriodicJob } from '../../core/jobs/periodic-job.js';
import { IntentsService } from '../payments/intents.service.js';
import { RidesService } from '../rides/rides.service.js';
import { UploadsService } from '../uploads/uploads.service.js';

/**
 * Deadlines nobody else enforces, run by the worker: card rides and top-ups not paid in time,
 * uploads started and never completed. Safe with several workers (rows are re-checked and
 * locked with SKIP LOCKED).
 */
@Injectable()
export class HousekeepingJob extends PeriodicJob {
  protected readonly intervalMs = 30_000;

  constructor(
    private readonly rides: RidesService,
    private readonly intents: IntentsService,
    private readonly uploads: UploadsService,
  ) {
    super();
  }

  async runOnce(now = new Date()) {
    const unpaidRides = await this.rides.expireUnpaid(now);
    const unpaidTopups = await this.intents.expireTopups(now);
    const uploads = await this.uploads.removeAbandoned(100, now);
    if (unpaidRides || unpaidTopups || uploads) {
      this.logger.log(
        `Expired ${unpaidRides} unpaid ride(s), ${unpaidTopups} top-up(s); removed ${uploads} upload(s)`,
      );
    }
    return { unpaidRides, unpaidTopups, uploads };
  }
}
