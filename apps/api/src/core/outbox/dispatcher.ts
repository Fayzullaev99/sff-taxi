import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { Counter, Gauge, type Registry } from 'prom-client';
import { setTimeout as sleep } from 'node:timers/promises';
import { Database } from '../db/database.js';
import type { DB } from '../db/schema.js';
import { reportError } from '../observability/sentry.js';
import { OUTBOX_HANDLERS, type OutboxEvent, type OutboxHandler } from './handler.js';

const BATCH_SIZE = 50;
/** How long a claimed event stays with the worker that took it before others may retry it. */
export const CLAIM_LEASE_SECONDS = 120;

interface ClaimedEvent {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  created_at: Date;
  /** Including this attempt. */
  attempts: number;
}
/** Order updates should reach screens within a second. */
const IDLE_POLL_MS = 300;
/** After this many failed attempts an event stays unpublished for manual review. */
export const MAX_ATTEMPTS = 10;

export const WORKER_METRICS = Symbol('WORKER_METRICS');

/** 5s, 10s, 20s ... capped at one hour. */
export function backoffSeconds(attempt: number): number {
  return Math.min(5 * 2 ** (attempt - 1), 3600);
}

/**
 * Hands outbox events to their handlers. Several workers can run side by side:
 * rows are claimed with FOR UPDATE SKIP LOCKED.
 */
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private running = false;
  private loop: Promise<void> | null = null;
  private lastCycleAt = 0;
  private readonly outcomes?: Counter<'result'>;

  constructor(
    private readonly db: Database,
    @Inject(OUTBOX_HANDLERS) private readonly handlers: OutboxHandler[],
    @Optional() @Inject(WORKER_METRICS) registry?: Registry,
  ) {
    if (registry) this.outcomes = this.registerMetrics(registry, db.kysely);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.log(
      `Outbox dispatcher started with handlers: ${this.handlers.map((h) => h.name).join(', ')}`,
    );
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  /** True while the loop keeps completing cycles; used by the worker health check. */
  isAlive(maxSilenceMs = 60_000): boolean {
    return this.running && Date.now() - this.lastCycleAt < maxSilenceMs;
  }

  /**
   * Processes up to BATCH_SIZE due events, one at a time; returns how many it looked at.
   *
   * Each event is claimed on its own (a short autocommitted UPDATE ... SKIP LOCKED) and its
   * handlers run outside any transaction:
   * - the attempt is counted at the claim, so an event whose handler crashes or kills the
   *   worker still uses up its attempts instead of being retried forever (a poison pill);
   * - the claim is a lease: a worker that dies mid-event leaves it due again after
   *   CLAIM_LEASE_SECONDS, and another worker picks it up;
   * - each handler's success is recorded at once, so a crash replays only the handlers
   *   that had not finished, not every event of a whole batch;
   * - no database connection or row lock is held while handlers call Expo or the SMS
   *   providers.
   */
  async runOnce(): Promise<number> {
    let seen = 0;
    while (seen < BATCH_SIZE) {
      const row = await this.claim();
      if (!row) break;
      seen++;
      await this.dispatch(row);
    }
    return seen;
  }

  /** Takes the oldest due event for this worker, counting the attempt. */
  async claim(): Promise<ClaimedEvent | null> {
    const row = await this.db.kysely
      .updateTable('outbox')
      .set((eb) => ({
        attempts: eb('attempts', '+', 1),
        next_attempt_at: sql<Date>`now() + make_interval(secs => ${CLAIM_LEASE_SECONDS})`,
      }))
      .where(
        'id',
        '=',
        this.db.kysely
          .selectFrom('outbox')
          .select('id')
          .where('processed_at', 'is', null)
          .where('attempts', '<', MAX_ATTEMPTS)
          // the database's clock, as for next_attempt_at's default: app and DB clocks may differ
          .where('next_attempt_at', '<=', sql<Date>`now()`)
          .orderBy('next_attempt_at')
          .orderBy('id')
          .limit(1)
          .forUpdate()
          .skipLocked(),
      )
      .where('processed_at', 'is', null)
      .returning(['id', 'topic', 'payload', 'created_at', 'attempts'])
      .executeTakeFirst();
    return row ?? null;
  }

  private async dispatch(row: ClaimedEvent): Promise<void> {
    const db = this.db.kysely;
    const event: OutboxEvent = {
      id: row.id,
      topic: row.topic,
      payload: row.payload,
      createdAt: row.created_at,
    };
    const delivered = new Set(
      (
        await db
          .selectFrom('outbox_deliveries')
          .select('handler')
          .where('event_id', '=', row.id)
          .execute()
      ).map((d) => d.handler),
    );

    const errors: string[] = [];
    for (const handler of this.handlers) {
      if (!handler.handles(event.topic) || delivered.has(handler.name)) continue;
      try {
        await handler.handle(event);
      } catch (error) {
        errors.push(`${handler.name}: ${(error as Error).message}`);
        continue;
      }
      await db
        .insertInto('outbox_deliveries')
        .values({ event_id: row.id, handler: handler.name })
        .onConflict((oc) => oc.columns(['event_id', 'handler']).doNothing())
        .execute();
    }

    if (errors.length === 0) {
      await db
        .updateTable('outbox')
        .set({ processed_at: new Date(), last_error: null })
        .where('id', '=', row.id)
        .execute();
      this.outcomes?.inc({ result: 'processed' });
      return;
    }
    const attempt = row.attempts;
    const lastError = errors.join('; ').slice(0, 2000);
    await db
      .updateTable('outbox')
      .set({
        next_attempt_at: sql<Date>`now() + make_interval(secs => ${backoffSeconds(attempt)})`,
        last_error: lastError,
      })
      .where('id', '=', row.id)
      .execute();
    const gaveUp = attempt >= MAX_ATTEMPTS;
    this.outcomes?.inc({ result: gaveUp ? 'dead' : 'retry' });
    this.logger[gaveUp ? 'error' : 'warn'](
      `Event ${row.id} (${row.topic}) attempt ${attempt} failed: ${lastError}`,
    );
    if (gaveUp) {
      reportError(new Error(`Outbox event gave up: ${row.topic}`), {
        eventId: row.id,
        lastError,
      });
    }
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        const processed = await this.runOnce();
        this.lastCycleAt = Date.now();
        if (processed < BATCH_SIZE) await sleep(IDLE_POLL_MS);
      } catch (error) {
        this.logger.error(`Dispatch cycle failed: ${(error as Error).message}`);
        reportError(error);
        await sleep(IDLE_POLL_MS * 10);
      }
    }
  }

  private registerMetrics(registry: Registry, db: Kysely<DB>): Counter<'result'> {
    new Gauge({
      name: 'outbox_pending_events',
      help: 'Events waiting to be processed (not yet given up on)',
      registers: [registry],
      async collect() {
        const row = await db
          .selectFrom('outbox')
          .select(sql<string>`count(*)`.as('count'))
          .where('processed_at', 'is', null)
          .where('attempts', '<', MAX_ATTEMPTS)
          .executeTakeFirstOrThrow();
        this.set(Number(row.count));
      },
    });
    new Gauge({
      name: 'outbox_oldest_pending_seconds',
      help: 'Age of the oldest event still waiting (alert when it grows: the worker is stuck)',
      registers: [registry],
      async collect() {
        const row = await db
          .selectFrom('outbox')
          .select(
            sql<number>`coalesce(extract(epoch from now() - min(created_at)), 0)::float8`.as('age'),
          )
          .where('processed_at', 'is', null)
          .where('attempts', '<', MAX_ATTEMPTS)
          .executeTakeFirstOrThrow();
        this.set(Number(row.age));
      },
    });
    new Gauge({
      name: 'outbox_dead_events',
      help: 'Events that exhausted their attempts and need manual review',
      registers: [registry],
      async collect() {
        const row = await db
          .selectFrom('outbox')
          .select(sql<string>`count(*)`.as('count'))
          .where('processed_at', 'is', null)
          .where('attempts', '>=', MAX_ATTEMPTS)
          .executeTakeFirstOrThrow();
        this.set(Number(row.count));
      },
    });
    return new Counter({
      name: 'outbox_dispatch_total',
      help: 'Dispatch outcomes per event attempt',
      labelNames: ['result'] as const,
      registers: [registry],
    });
  }
}
