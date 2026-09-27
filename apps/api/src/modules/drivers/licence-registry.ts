import { v7 as uuidv7 } from 'uuid';
import type { Env } from '../../config/env.js';
import type { Tx } from '../../core/db/database.js';
import { emit } from '../../core/outbox/outbox.js';

/** What a registry (or an operator) says about a driver's passenger-transport licence card. */
export interface LicenceVerdict {
  result: 'valid' | 'invalid';
  /** Valid until, when the registry says. */
  expiresOn: string | null;
  note: string | null;
  /** The registry's answer as received, for the record. */
  raw: unknown;
}

export interface LicenceQuery {
  driverId: string;
  fullName: string;
  pinfl: string;
  licenceCardNumber: string;
  plate: string | null;
}

/**
 * Checks licence cards against the Ministry of Transport (Resolution 200: an aggregator
 * serves only licensed carriers and shares liability for unlicensed ones).
 *
 * - 'manual' (default, until the Ministry's API is available to us): verify() returns null
 *   and the application waits in the operators' queue; an operator compares the card with
 *   the Ministry's public registry and records the result (POST admin/drivers/:id/licence).
 * - a registry integration returns a verdict; a temporary failure throws and the worker
 *   retries the outbox event.
 *
 * To add the Ministry's API: implement this, add its name to LICENCE_REGISTRY in
 * src/config/env.ts and return it from createLicenceRegistry (docs/fiscal-and-licence.md).
 */
export interface LicenceRegistry {
  readonly name: 'manual' | 'mintrans';
  verify(query: LicenceQuery): Promise<LicenceVerdict | null>;
}

export const LICENCE_REGISTRY = Symbol('LICENCE_REGISTRY');

export class ManualLicenceRegistry implements LicenceRegistry {
  readonly name = 'manual';

  verify(): Promise<LicenceVerdict | null> {
    return Promise.resolve(null);
  }
}

export function createLicenceRegistry(env: Env): LicenceRegistry {
  switch (env.LICENCE_REGISTRY) {
    case 'manual':
      return new ManualLicenceRegistry();
  }
}

/**
 * Records a check and puts its result on the driver's profile. An invalid card ends the
 * shift at once (approval and going online need a valid one).
 */
export async function recordLicenceCheck(
  trx: Tx,
  c: {
    driverId: string;
    source: 'manual' | 'mintrans';
    licenceCardNumber: string;
    verdict: LicenceVerdict;
    checkedBy: string | null;
  },
): Promise<void> {
  const now = new Date();
  await trx
    .insertInto('licence_checks')
    .values({
      id: uuidv7(),
      driver_id: c.driverId,
      source: c.source,
      licence_card_number: c.licenceCardNumber,
      result: c.verdict.result,
      expires_on: c.verdict.expiresOn,
      note: c.verdict.note,
      raw: c.verdict.raw === undefined ? null : JSON.stringify(c.verdict.raw),
      checked_by: c.checkedBy,
    })
    .execute();
  await trx
    .updateTable('drivers')
    .set({
      licence_status: c.verdict.result,
      licence_checked_at: now,
      ...(c.verdict.result === 'invalid' ? { is_online: false, online_since: null } : {}),
      updated_at: now,
    })
    .where('user_id', '=', c.driverId)
    .execute();
  // the driver's status screen updates at once instead of on its next refetch
  await emit(trx, 'driver.licence_checked', { driverId: c.driverId, result: c.verdict.result });
}
