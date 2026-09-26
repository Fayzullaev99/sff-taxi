import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../core/db/database.js';
import type { OutboxEvent, OutboxHandler } from '../../core/outbox/handler.js';
import { LICENCE_REGISTRY, type LicenceRegistry, recordLicenceCheck } from './licence-registry.js';

/**
 * Asks the licence registry about a driver's card when they apply or change it. With the
 * manual registry nothing happens here: the application waits for an operator.
 */
@Injectable()
export class LicenceHandler implements OutboxHandler {
  readonly name = 'licence';

  constructor(
    private readonly db: Database,
    @Inject(LICENCE_REGISTRY) private readonly registry: LicenceRegistry,
  ) {}

  handles(topic: string): boolean {
    return topic === 'driver.licence_check_requested';
  }

  async handle(event: OutboxEvent): Promise<void> {
    const driverId = String(event.payload.driverId);
    const d = await this.db.kysely
      .selectFrom('drivers as d')
      .leftJoin('vehicles as v', 'v.driver_id', 'd.user_id')
      .select(['d.full_name', 'd.pinfl', 'd.licence_card_number', 'd.licence_status', 'v.plate'])
      .where('d.user_id', '=', driverId)
      .executeTakeFirst();
    // already decided (an operator was faster), or gone
    if (!d || d.licence_status !== 'unverified') return;
    const verdict = await this.registry.verify({
      driverId,
      fullName: d.full_name,
      pinfl: d.pinfl,
      licenceCardNumber: d.licence_card_number,
      plate: d.plate,
    });
    if (!verdict) return;
    await this.db.transaction(async (trx) => {
      // the card may have changed while the registry answered: only this card's verdict counts
      const now = await trx
        .selectFrom('drivers')
        .select(['licence_card_number', 'licence_status'])
        .where('user_id', '=', driverId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (
        now.licence_card_number !== d.licence_card_number ||
        now.licence_status !== 'unverified'
      ) {
        return;
      }
      await recordLicenceCheck(trx, {
        driverId,
        source: this.registry.name,
        licenceCardNumber: d.licence_card_number,
        verdict,
        checkedBy: null,
      });
    });
  }
}
