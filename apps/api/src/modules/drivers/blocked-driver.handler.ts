import { Injectable } from '@nestjs/common';
import type { OutboxEvent, OutboxHandler } from '../../core/outbox/handler.js';
import { IntercityService } from '../intercity/intercity.service.js';
import { RidesService } from '../rides/rides.service.js';

/**
 * A blocked driver keeps nobody waiting: rides they had not started go back to dispatch
 * (a trip under way is finished), their open trip-board departures are called off with
 * deposits refunded. Safe to repeat: each step re-reads the current state.
 */
@Injectable()
export class BlockedDriverHandler implements OutboxHandler {
  readonly name = 'blocked-driver';

  constructor(
    private readonly rides: RidesService,
    private readonly intercity: IntercityService,
  ) {}

  handles(topic: string): boolean {
    return topic === 'driver.status_changed';
  }

  async handle(event: OutboxEvent): Promise<void> {
    if (event.payload.to !== 'blocked') return;
    const driverId = String(event.payload.driverId);
    await this.rides.releaseRidesOfBlockedDriver(driverId);
    await this.intercity.cancelTripsOfBlockedDriver(driverId);
  }
}
