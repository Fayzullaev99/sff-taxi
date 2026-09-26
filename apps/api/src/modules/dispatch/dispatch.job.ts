import { Inject, Injectable, Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { ENV, type Env } from '../../config/env.js';
import { reportError } from '../../core/observability/sentry.js';
import { DispatchService } from './dispatch.service.js';

/** The worker's dispatch loop: expires offers and moves waiting rides on every tick. */
@Injectable()
export class DispatchJob {
  private readonly logger = new Logger(DispatchJob.name);
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly dispatch: DispatchService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
    this.logger.log(`Dispatch loop every ${this.env.DISPATCH_TICK_MS} ms`);
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.dispatch.tick(new Date());
      } catch (error) {
        this.logger.error(`Dispatch tick failed: ${(error as Error).message}`);
        reportError(error);
      }
      await sleep(this.env.DISPATCH_TICK_MS);
    }
  }
}
