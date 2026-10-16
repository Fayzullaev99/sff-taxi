import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { RIDE_SERVICES } from '../../core/db/schema.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { BillingModule } from '../billing/billing.module.js';
import { PromosService } from './promos.service.js';

const Cursor = z.object({ cursor: z.uuid().optional() });
/** The install's own random id (the app keeps it): one invitation per device. */
const DeviceId = z
  .string()
  .trim()
  .regex(/^[\w-]{8,100}$/, 'Qurilma identifikatori noto‘g‘ri');
const CodeBody = z.object({
  code: z.string().trim().min(3).max(30),
  deviceId: DeviceId.nullable().default(null),
});
const WalletQuery = z.object({ deviceId: DeviceId.optional() });
const Soum = z.number().int().min(0).max(10_000_000);
const When = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .nullable()
  .default(null);
/** Taxi classes and cargo classes (other branches may add more: kept as text). */
const ClassName = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/, 'Sinf nomi noto‘g‘ri');
const PromoBody = z
  .object({
    code: z.string().trim().min(3).max(30),
    kind: z.enum(['percent', 'fixed']),
    value: z.number().int().min(1).max(10_000_000),
    maxDiscount: Soum.nullable().default(null),
    minFare: Soum.default(0),
    validFrom: When,
    validUntil: When,
    usageLimit: z.number().int().min(1).max(10_000_000).nullable().default(null),
    perRiderLimit: z.number().int().min(1).max(100).default(1),
    firstRideOnly: z.boolean().default(false),
    services: z.array(z.enum(RIDE_SERVICES)).max(3).default([]),
    classes: z.array(ClassName).max(10).default([]),
    cityId: z.uuid().nullable().default(null),
    isActive: z.boolean().default(true),
    description: z.string().trim().min(1).max(300).nullable().default(null),
    /** The same for Russian apps (optional: the Uzbek text is shown without it). */
    descriptionRu: z.string().trim().min(1).max(300).nullable().default(null),
  })
  .refine((p) => p.kind !== 'percent' || p.value <= 100, {
    message: 'Foiz 1 dan 100 gacha bo‘ladi',
    path: ['value'],
  })
  .refine((p) => p.kind !== 'percent' || (p.maxDiscount !== null && p.maxDiscount > 0), {
    message: 'Foizli promokodga eng ko‘p chegirma summasini yozing',
    path: ['maxDiscount'],
  })
  .refine((p) => !p.validFrom || !p.validUntil || p.validUntil > p.validFrom, {
    message: 'Tugash sanasi boshlanishidan keyin bo‘lishi kerak',
    path: ['validUntil'],
  });
const AdminListQuery = z.object({
  q: z.string().trim().min(1).max(30).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
const ReferralsQuery = z.object({
  status: z.enum(['pending', 'rewarded', 'capped', 'revoked']).optional(),
  q: z.string().trim().min(1).max(20).optional(),
  cursor: z.uuid().optional(),
});
const RevokeBody = z.object({ note: z.string().trim().min(3).max(300) });

/** The rider's promo codes, ride credit and invitation ("Do'stni taklif qil"). */
@Controller('promos')
export class RiderPromosController {
  constructor(private readonly promos: PromosService) {}

  /** `deviceId`: this install (a code entered from it later is the rider's own). */
  @Get()
  wallet(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(WalletQuery)) q: z.output<typeof WalletQuery>,
  ) {
    return this.promos.wallet(user.userId, q.deviceId ?? null);
  }

  /** A promo code (saved to the wallet) or a friend's invitation code. */
  @Post()
  @RateLimit({ name: 'promos:add', by: 'user', max: 20, windowSeconds: 60 })
  @HttpCode(HttpStatus.OK)
  add(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CodeBody)) body: z.output<typeof CodeBody>) {
    return this.promos.addCode(user, body.code, body.deviceId);
  }

  @Get('credits')
  credits(@CurrentUser() user: AuthUser, @Query(new ZodPipe(Cursor)) q: z.output<typeof Cursor>) {
    return this.promos.credits(user.userId, q.cursor);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.promos.removePromo(user.userId, id);
  }
}

@Controller('admin/promos')
@AdminOnly()
export class AdminPromosController {
  constructor(private readonly promos: PromosService) {}

  @Get()
  list(@Query(new ZodPipe(AdminListQuery)) q: z.output<typeof AdminListQuery>) {
    return this.promos.adminList(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.promos.adminGet(id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PromoBody)) body: z.output<typeof PromoBody>,
  ) {
    return this.promos.create(user, body);
  }

  /** The whole code as edited (switching it off: `isActive: false`). */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(PromoBody)) body: z.output<typeof PromoBody>,
  ) {
    return this.promos.update(id, body);
  }
}

@Controller('admin/referrals')
@AdminOnly()
export class AdminReferralsController {
  constructor(private readonly promos: PromosService) {}

  @Get()
  list(@Query(new ZodPipe(ReferralsQuery)) q: z.output<typeof ReferralsQuery>) {
    return this.promos.adminReferrals(q);
  }

  /** Abuse: no welcome discount from now on, the referrer's reward taken back. */
  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RevokeBody)) body: z.output<typeof RevokeBody>,
  ) {
    return this.promos.revokeReferral(user, id, body.note);
  }
}

@Controller('admin/riders')
@AdminOnly()
export class AdminRiderPromosController {
  constructor(private readonly promos: PromosService) {}

  /** A rider's ride credit with its history and referrals. */
  @Get(':id/promos')
  rider(@Param('id', ParseUUIDPipe) id: string) {
    return this.promos.adminRider(id);
  }
}

/** The service, for the rides module (quotes, orders, completion, cancellation). */
@Module({
  imports: [BillingModule],
  providers: [PromosService],
  exports: [PromosService],
})
export class PromosCoreModule {}

@Module({
  imports: [PromosCoreModule],
  controllers: [
    RiderPromosController,
    AdminPromosController,
    AdminReferralsController,
    AdminRiderPromosController,
  ],
})
export class PromosModule {}
