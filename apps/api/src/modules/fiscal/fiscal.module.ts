import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { AdminOnly } from '../../core/auth/auth-context.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import type { OutboxEvent, OutboxHandler } from '../../core/outbox/handler.js';
import { createFiscalProvider, FISCAL_PROVIDER } from './fiscal-provider.js';
import { FiscalService } from './fiscal.service.js';

const ListQuery = z.object({
  status: z.enum(['pending', 'sent', 'skipped']).optional(),
  cursor: z.uuid().optional(),
});
const ResendBody = z.object({ status: z.enum(['skipped', 'pending']) });

/** The worker issues each receipt from its outbox event; a failure retries with backoff. */
@Injectable()
export class FiscalHandler implements OutboxHandler {
  readonly name = 'fiscal';

  constructor(private readonly fiscal: FiscalService) {}

  handles(topic: string): boolean {
    return topic === 'fiscal.receipt_due';
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    await this.fiscal.issue(
      typeof p.rideId === 'string' ? { rideId: p.rideId } : { bookingId: String(p.bookingId) },
    );
  }
}

@Controller('admin/fiscal')
@AdminOnly()
export class AdminFiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  /** Receipts with their payloads: sent, pending (being retried) or skipped (no provider). */
  @Get('receipts')
  list(@Query(new ZodPipe(ListQuery)) q: z.output<typeof ListQuery>) {
    return this.fiscal.list(q);
  }

  /** Queues skipped receipts once a provider is switched on, or pending ones again. */
  @Post('receipts/resend')
  @HttpCode(HttpStatus.OK)
  async resend(@Body(new ZodPipe(ResendBody)) body: z.output<typeof ResendBody>) {
    return { queued: await this.fiscal.resend(body.status) };
  }
}

/** The provider and the service, for the API (views) and the worker (issuing). */
@Module({
  providers: [
    {
      provide: FISCAL_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) => createFiscalProvider(env),
    },
    FiscalService,
    FiscalHandler,
  ],
  exports: [FiscalService, FiscalHandler, FISCAL_PROVIDER],
})
export class FiscalCoreModule {}

@Module({ imports: [FiscalCoreModule], controllers: [AdminFiscalController] })
export class FiscalModule {}
