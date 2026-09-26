import { Injectable } from '@nestjs/common';
import { Database } from '../../core/db/database.js';
import { ACTIVE_RIDE_STATUSES } from '../../core/db/schema.js';
import { PeriodicJob } from '../../core/jobs/periodic-job.js';
import { RealtimeBus } from './realtime.publisher.js';

/** Positions older than this are not on the operators' map (the driver lost signal). */
const FRESH_SECONDS = 120;

/**
 * The operators' live map: every few seconds, one batch event with every online driver's last
 * good position and whether they are busy, instead of a message per GPS fix (drivers send one
 * every 3-5 s). Only operators receive it.
 */
@Injectable()
export class PositionsJob extends PeriodicJob {
  protected readonly intervalMs = 5000;

  constructor(
    private readonly db: Database,
    private readonly bus: RealtimeBus,
  ) {
    super();
  }

  async runOnce(now = new Date()) {
    const rows = await this.db.kysely
      .selectFrom('drivers as d')
      .select(['d.user_id', 'd.lat', 'd.lng', 'd.heading', 'd.located_at'])
      .select(({ exists, selectFrom }) =>
        exists(
          selectFrom('rides as r')
            .select('r.id')
            .whereRef('r.driver_id', '=', 'd.user_id')
            .where('r.status', 'in', [...ACTIVE_RIDE_STATUSES]),
        ).as('busy'),
      )
      .where('d.is_online', '=', true)
      .where('d.lat', 'is not', null)
      .where('d.located_at', '>=', new Date(now.getTime() - FRESH_SECONDS * 1000))
      .execute();
    if (!rows.length) return 0;
    await this.bus.publish({
      to: { admins: true },
      event: {
        type: 'drivers.positions',
        drivers: rows.map((r) => ({
          id: r.user_id,
          lat: r.lat!,
          lng: r.lng!,
          heading: r.heading,
          at: r.located_at!.toISOString(),
          busy: Boolean(r.busy),
        })),
      },
    });
    return rows.length;
  }
}
