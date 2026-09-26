import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { Database } from '../../core/db/database.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { tashkentDayStart, tashkentWeekStart } from '../../lib/commission.js';
import { RideChargesService } from './charges.service.js';
import { LedgerService } from './ledger.service.js';

const Cursor = z.object({ cursor: z.uuid().optional() });
const EarningsQuery = z.object({ period: z.enum(['day', 'week']).default('day') });
const TaxQuery = z.object({ period: z.string().regex(/^d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM') });
const RemitBody = TaxQuery.extend({ reference: z.string().trim().min(3).max(100) });
const PassBody = z.object({ kind: z.enum(['day', 'week']) });
const EntryBody = z.object({
  kind: z.enum(['topup', 'adjustment']),
  amount: z
    .number()
    .int()
    .min(-10_000_000)
    .max(10_000_000)
    .refine((v) => v !== 0, 'Summa 0 bo‘lmasligi kerak'),
  note: z.string().trim().min(1).max(300).nullable().default(null),
});

@Controller('driver')
export class DriverBillingController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly charges: RideChargesService,
    private readonly db: Database,
  ) {}

  /** Today's or this week's rides, fares, cash collected, commission, tax and net (Tashkent time). */
  @Get('earnings')
  async earnings(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(EarningsQuery)) q: z.output<typeof EarningsQuery>,
  ) {
    await this.assertDriver(user.userId);
    const now = new Date();
    const from = q.period === 'day' ? tashkentDayStart(now) : tashkentWeekStart(now);
    return this.charges.earnings(user.userId, from, now);
  }

  /** Balance, whether it allows working, the running pass and the latest entries. */
  @Get('balance')
  async balance(@CurrentUser() user: AuthUser) {
    await this.assertDriver(user.userId);
    const [standing, pass, entries] = await Promise.all([
      this.ledger.standing(user.userId),
      this.ledger.activePass(user.userId, new Date()),
      this.ledger.entries(user.userId),
    ]);
    return { ...standing, activePass: pass, entries: entries.items };
  }

  @Get('ledger')
  async entries(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(Cursor)) q: z.output<typeof Cursor>,
  ) {
    await this.assertDriver(user.userId);
    return this.ledger.entries(user.userId, q.cursor);
  }

  @Get('passes')
  async passes(@CurrentUser() user: AuthUser) {
    await this.assertDriver(user.userId);
    return this.ledger.passes(user.userId);
  }

  /** Buys a day or week pass from the balance: city rides without commission meanwhile. */
  @Post('passes')
  @HttpCode(HttpStatus.CREATED)
  async buyPass(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PassBody)) body: z.output<typeof PassBody>,
  ) {
    await this.assertDriver(user.userId);
    return this.ledger.buyPass(user.userId, body.kind);
  }

  private async assertDriver(userId: string): Promise<void> {
    const d = await this.db.kysely
      .selectFrom('drivers')
      .select('status')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!d) throw new NotFoundException('Siz haydovchi sifatida ro‘yxatdan o‘tmagansiz');
  }
}

@Controller('admin/billing')
@AdminOnly()
export class AdminBillingController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly charges: RideChargesService,
  ) {}

  /** The 1% tax withheld per driver for a Tashkent month, for remittance by the 15th. */
  @Get('taxes')
  taxes(@Query(new ZodPipe(TaxQuery)) q: z.output<typeof TaxQuery>) {
    return this.charges.taxReport(q.period);
  }

  @Post('taxes/remit')
  @HttpCode(HttpStatus.OK)
  remit(@Body(new ZodPipe(RemitBody)) body: z.output<typeof RemitBody>) {
    return this.charges.markRemitted(body.period, body.reference);
  }

  @Get('drivers/:id/ledger')
  entries(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(Cursor)) q: z.output<typeof Cursor>,
  ) {
    return this.ledger.entries(id, q.cursor);
  }

  /** Cash top-up received at the office, or a signed correction with a note. */
  @Post('drivers/:id/ledger')
  @HttpCode(HttpStatus.CREATED)
  record(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(EntryBody)) body: z.output<typeof EntryBody>,
  ) {
    return this.ledger.record(user.userId, id, body);
  }
}

@Module({
  controllers: [DriverBillingController, AdminBillingController],
  providers: [LedgerService, RideChargesService],
  exports: [LedgerService, RideChargesService],
})
export class BillingModule {}
