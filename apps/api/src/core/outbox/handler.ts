export interface OutboxEvent {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Reacts to events. Delivery is at-least-once: a handler may see the same
 * event again after a crash, so it must be safe to repeat.
 */
export interface OutboxHandler {
  /** Stable id, recorded per delivered event. Renaming it re-delivers old events. */
  readonly name: string;
  handles(topic: string): boolean;
  handle(event: OutboxEvent): Promise<void>;
}

export const OUTBOX_HANDLERS = Symbol('OUTBOX_HANDLERS');
