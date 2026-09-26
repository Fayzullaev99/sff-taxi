import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { Counter, Gauge, type Registry } from 'prom-client';
import { setTimeout as sleep } from 'node:timers/promises';
import { Database } from '../db/database.js';
import type { DB } from '../db/schema.js';
import { reportError } from '../observability/sentry.js';
import { OUTBOX_HANDLERS, type OutboxEvent, type OutboxHandler } from './handler.js';

const BATCH_SIZE = 50;
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

  /** Processes one batch; returns how many events it looked at. */
  async runOnce(): Promise<number> {
    return this.db.transaction(async (trx) => {
      const rows = await trx
        .selectFrom('outbox')
        .select(['id', 'topic', 'payload', 'created_at', 'attempts'])
        .where('processed_at', 'is', null)
        .where('attempts', '<', MAX_ATTEMPTS)
        .where('next_attempt_at', '<=', new Date())
        .orderBy('id')
        .limit(BATCH_SIZE)
        .forUpdate()
        .skipLocked()
        .execute();

      for (const row of rows) {
        const event: OutboxEvent = {
          id: row.id,
          topic: row.topic,
          payload: row.payload,
          createdAt: row.created_at,
        };
        const delivered = new Set(
          (
            await trx
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
            await trx
              .insertInto('outbox_deliveries')
              .values({ event_id: row.id, handler: handler.name })
              .execute();
          } catch (error) {
            errors.push(`${handler.name}: ${(error as Error).message}`);
          }
        }

        if (errors.length === 0) {
          await trx
            .updateTable('outbox')
            .set({ processed_at: new Date(), last_error: null })
            .where('id', '=', row.id)
            .execute();
          this.outcomes?.inc({ result: 'processed' });
          continue;
        }
        const attempt = row.attempts + 1;
        const lastError = errors.join('; ').slice(0, 2000);
        await trx
          .updateTable('outbox')
          .set({
            attempts: attempt,
            next_attempt_at: new Date(Date.now() + backoffSeconds(attempt) * 1000),
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
      return rows.length;
    });
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
