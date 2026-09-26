import { Injectable } from '@nestjs/common';
import type { OutboxEvent, OutboxHandler } from '../../core/outbox/handler.js';
import { DispatchService } from './dispatch.service.js';

/**
 * Moves a ride on as soon as something happened to it (a new ride, a declined offer, a
 * driver who dropped it) instead of waiting for the next tick. Safe to repeat: the
 * dispatcher looks at the ride's current state.
 */
@Injectable()
export class DispatchHandler implements OutboxHandler {
  readonly name = 'dispatch';

  constructor(private readonly dispatch: DispatchService) {}

  handles(topic: string): boolean {
    return topic === 'ride.requested' || topic === 'ride.offer_closed';
  }

  async handle(event: OutboxEvent): Promise<void> {
    await this.dispatch.processRide(String(event.payload.rideId), new Date());
  }
}
