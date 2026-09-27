import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, type AuthUser, CurrentUser, Public } from '../../core/auth/auth-context.js';
import { UzPhone } from '../../core/auth/phone.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { BillingModule } from '../billing/billing.module.js';
import { ClickService } from './click.service.js';
import { IntentsService } from './intents.service.js';
import { TOPUP_MAX, TOPUP_MIN } from './payment-config.js';
import { PaymeService } from './payme.service.js';
import { PaymentsService } from './payments.service.js';

const TopupBody = z.object({
  amount: z
    .number()
    .int()
    .min(TOPUP_MIN, `Kamida ${TOPUP_MIN} so‘m`)
    .max(TOPUP_MAX, `Ko‘pi bilan ${TOPUP_MAX} so‘m`),
});
const RefundBody = z.object({ reference: z.string().trim().min(3).max(200) });
const DayString = z.iso.date('Sana YYYY-MM-DD ko‘rinishida');
const IntentsQuery = z.object({
  purpose: z.enum(['ride', 'topup']).optional(),
  /** pending, paid, expired, cancelled, refund_pending, refunded, or failed (= expired or cancelled). */
  status: z
    .enum(['pending', 'paid', 'expired', 'cancelled', 'refund_pending', 'refunded', 'failed'])
    .optional(),
  provider: z.enum(['payme', 'click']).optional(),
  driverId: z.uuid().optional(),
  rideId: z.uuid().optional(),
  phone: UzPhone.optional(),
  from: DayString.optional(),
  to: DayString.optional(),
  cursor: z.uuid().optional(),
});
const SummaryQuery = z.object({ from: DayString.optional(), to: DayString.optional() });

/**
 * Provider callbacks. They are public: Payme authenticates with Basic auth (our merchant
 * key), Click signs every request with our secret key. Both always answer HTTP 200 with
 * their own error codes in the body, as the providers expect. Never rate-limited: the
 * providers call from a few addresses and retry.
 */
@Controller('payments')
export class PaymentCallbacksController {
  constructor(
    private readonly payme: PaymeService,
    private readonly click: ClickService,
  ) {}

  /** Set https://<api>/v1/payments/payme as the endpoint in the Payme merchant cabinet. */
  @Public()
  @Post('payme')
  @HttpCode(HttpStatus.OK)
  paymeRpc(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    return this.payme.handle(authorization, body ?? {});
  }

  /** Click cabinet: Prepare URL https://<api>/v1/payments/click/prepare. */
  @Public()
  @Post('click/prepare')
  @HttpCode(HttpStatus.OK)
  clickPrepare(@Body() body: Record<string, unknown> | undefined) {
    return this.click.handle('prepare', body ?? {});
  }

  /** Click cabinet: Complete URL https://<api>/v1/payments/click/complete. */
  @Public()
  @Post('click/complete')
  @HttpCode(HttpStatus.OK)
  clickComplete(@Body() body: Record<string, unknown> | undefined) {
    return this.click.handle('complete', body ?? {});
  }
}

/** Drivers top up their prepaid balance by card. */
@Controller('driver/topups')
export class DriverTopupsController {
  constructor(private readonly intents: IntentsService) {}

  /** Starts a top-up: open one of `checkout` in the browser; the balance grows once paid. */
  @Post()
  @RateLimit({ name: 'topups', by: 'user', max: 20, windowSeconds: 3600 })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(TopupBody)) body: z.output<typeof TopupBody>,
  ) {
    return this.intents.createTopup(user, body.amount);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.intents.topups(user.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.intents.topup(user, id);
  }
}

@Controller('admin/payments')
@AdminOnly()
export class AdminPaymentsController {
  constructor(private readonly intents: IntentsService) {}

  /** Card payments (ride prepayments and top-ups), newest first, with filters. */
  @Get('intents')
  intentsList(@Query(new ZodPipe(IntentsQuery)) q: z.output<typeof IntentsQuery>) {
    return this.intents.adminList(q);
  }

  /** Count and amount per purpose and status over Tashkent days. */
  @Get('intents/summary')
  intentsSummary(@Query(new ZodPipe(SummaryQuery)) q: z.output<typeof SummaryQuery>) {
    return this.intents.adminSummary(q);
  }

  /** Paid card rides that were cancelled: refund them in the provider's cabinet. */
  @Get('refunds')
  refunds() {
    return this.intents.refundQueue();
  }

  /**
   * Records a refund made outside a Payme callback (a Click reversal, a bank transfer).
   * Payme refunds made in its cabinet are recorded by its CancelTransaction call.
   */
  @Post(':id/refunded')
  @HttpCode(HttpStatus.OK)
  refunded(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RefundBody)) body: z.output<typeof RefundBody>,
  ) {
    return this.intents.confirmRefund(id, body.reference);
  }
}

/** What rides and the worker need: payment intents and the methods on offer. */
@Module({
  imports: [BillingModule],
  providers: [IntentsService, PaymentsService],
  exports: [IntentsService, PaymentsService],
})
export class PaymentsCoreModule {}

@Module({
  imports: [PaymentsCoreModule],
  controllers: [PaymentCallbacksController, DriverTopupsController, AdminPaymentsController],
  providers: [PaymeService, ClickService],
})
export class PaymentsModule {}
