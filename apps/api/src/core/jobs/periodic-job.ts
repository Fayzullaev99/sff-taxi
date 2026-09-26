import { Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { reportError } from '../observability/sentry.js';

/**
 * A loop the worker runs every `intervalMs`: one pass at a time, errors logged and reported
 * but never ending the loop, stopped promptly on shutdown. Several workers may run the same
 * job: each pass must lock (SKIP LOCKED) or re-check what it changes.
 */
export abstract class PeriodicJob {
  protected readonly logger = new Logger(this.constructor.name);
  private running = false;
  private loop: Promise<void> | null = null;
  private abort = new AbortController();

  protected abstract readonly intervalMs: number;

  /** One pass. */
  abstract runOnce(now?: Date): Promise<unknown>;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abort.abort();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce();
      } catch (error) {
        this.logger.error(`Pass failed: ${(error as Error).message}`);
        reportError(error);
      }
      await sleep(this.intervalMs, undefined, { signal: this.abort.signal }).catch(() => undefined);
    }
  }
}
