import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { PaymentsCoreModule } from '../payments/payments.module.js';
import { TipsService } from './tips.service.js';

const TipBody = z.object({
  amount: z.number().int().min(1).max(10_000_000),
  /** cash: the rider hands it over (recorded); card: paid through Payme/Click. */
  method: z.enum(['cash', 'card']),
});

@Controller('rides/:id/tip')
export class RiderTipsController {
  constructor(private readonly tips: TipsService) {}

  /** The ride's tip (or null) and the rating screen's presets, limits, whether card works. */
  @Get()
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tips.forRider(user, id);
  }

  /** One tip per ride: a repeat answers the same tip; a card tip carries checkout links. */
  @Post()
  @RateLimit({ name: 'tips:give', by: 'user', max: 10, windowSeconds: 60 })
  give(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(TipBody)) body: z.output<typeof TipBody>,
  ) {
    return this.tips.give(user, id, body);
  }
}

@Controller('driver/rides/:id/tip')
export class DriverTipsController {
  constructor(private readonly tips: TipsService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { tip: await this.tips.forDriver(user, id) };
  }
}

@Controller('admin/rides/:id/tip')
@AdminOnly()
export class AdminTipsController {
  constructor(private readonly tips: TipsService) {}

  @Get()
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { tip: await this.tips.forOperator(id) };
  }
}

/** The service, for the worker's housekeeping (unpaid card tips expire). */
@Module({
  imports: [PaymentsCoreModule],
  providers: [TipsService],
  exports: [TipsService],
})
export class TipsCoreModule {}

@Module({
  imports: [TipsCoreModule],
  controllers: [RiderTipsController, DriverTipsController, AdminTipsController],
})
export class TipsModule {}
