import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { sql } from 'kysely';
import { Histogram, type Registry } from 'prom-client';
import { ENV, type Env } from './config/env.js';
import { Database } from './core/db/database.js';
import { OutboxDispatcher, WORKER_METRICS } from './core/outbox/dispatcher.js';
import { reportError } from './core/observability/sentry.js';
import { DispatchJob } from './modules/dispatch/dispatch.job.js';
import { HousekeepingJob } from './modules/housekeeping/housekeeping.job.js';
import { PositionsJob } from './modules/realtime/positions.job.js';

/** Starts the dispatcher, periodic jobs and a small HTTP server for the container health check and Prometheus. */
@Injectable()
export class WorkerRuntime implements OnApplicationShutdown {
  private readonly logger = new Logger(WorkerRuntime.name);
  private server: Server | null = null;

  constructor(
    private readonly dispatcher: OutboxDispatcher,
    private readonly db: Database,
    @Inject(WORKER_METRICS) private readonly registry: Registry,
    @Inject(ENV) private readonly env: Env,
    private readonly dispatch: DispatchJob,
    private readonly housekeeping: HousekeepingJob,
    private readonly positions: PositionsJob,
  ) {}

  async start(): Promise<void> {
    this.dispatcher.start();
    const ticks = new Histogram({
      name: 'dispatch_tick_seconds',
      help: 'Duration of one dispatcher tick (expire offers, move every waiting ride on)',
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.dispatch.onTick = (seconds) => ticks.observe(seconds);
    this.dispatch.start();
    this.housekeeping.start();
    this.positions.start();
    this.server = createServer((req, res) => void this.serve(req.url ?? '', res));
    await new Promise<void>((resolve) => this.server!.listen(this.env.WORKER_HTTP_PORT, resolve));
    this.logger.log(`Worker health and metrics on :${this.env.WORKER_HTTP_PORT}`);
  }

  /** SIGTERM: stop taking work and finish the current batch before pools close. */
  async onApplicationShutdown(): Promise<void> {
    await new Promise((resolve) => (this.server ? this.server.close(resolve) : resolve(null)));
    await Promise.all([
      this.dispatcher.stop(),
      this.dispatch.stop(),
      this.housekeeping.stop(),
      this.positions.stop(),
    ]);
  }

  private async serve(url: string, res: ServerResponse): Promise<void> {
    try {
      if (url === '/health') {
        await sql`select 1`.execute(this.db.kysely);
        const alive = this.dispatcher.isAlive();
        res.writeHead(alive ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: alive ? 'ok' : 'stalled', database: 'up' }));
        return;
      }
      if (url === '/metrics') {
        res.writeHead(200, { 'Content-Type': this.registry.contentType });
        res.end(await this.registry.metrics());
        return;
      }
      res.writeHead(404).end();
    } catch (error) {
      reportError(error);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error' }));
    }
  }
}
