import { Injectable } from '@nestjs/common';
import { PeriodicJob } from '../../core/jobs/periodic-job.js';
import { UploadsService } from '../uploads/uploads.service.js';

/** Clean-up in the worker: uploads that were started and never completed. */
@Injectable()
export class HousekeepingJob extends PeriodicJob {
  protected readonly intervalMs = 10 * 60_000;

  constructor(private readonly uploads: UploadsService) {
    super();
  }

  async runOnce(now = new Date()) {
    const uploads = await this.uploads.removeAbandoned(100, now);
    if (uploads) this.logger.log(`Removed ${uploads} abandoned upload(s)`);
    return { uploads };
  }
}
