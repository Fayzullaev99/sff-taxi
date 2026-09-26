import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AdminOnly, type AuthUser, CurrentUser, Public } from '../../core/auth/auth-context.js';
import { UzPhone } from '../../core/auth/phone.js';
import { RIDE_STATUSES } from '../../core/db/schema.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { RIDE_CLASSES, RIDE_OPTIONS } from '../../lib/tariff.js';
import { BillingModule } from '../billing/billing.module.js';
import { GeoCoreModule } from '../geo/geo-core.module.js';
import { GeoService } from '../geo/geo.service.js';
import { PaymentsCoreModule } from '../payments/payments.module.js';
import { PaymentsService } from '../payments/payments.service.js';
import { DRIVER_CANCEL_REASONS, type DriverCancelReason, RidesService } from './rides.service.js';

const Lat = z.number().min(-90).max(90);
const Lng = z.number().min(-180).max(180);
const PointBody = z.object({ lat: Lat, lng: Lng });
const Address = z.string().trim().min(1).max(300).nullable().default(null);
const Landmark = z.string().trim().min(1).max(200).nullable().default(null);
const PlaceBody = PointBody.extend({ address: Address, landmark: Landmark });
const PlaceText = z
  .object({ address: Address, landmark: Landmark })
  .default({ address: null, landmark: null });
const Options = z.array(z.enum(RIDE_OPTIONS)).max(4).default([]);
const Comment = z.string().trim().min(1).max(500).nullable().default(null);

const QuoteBody = z.object({ pickup: PointBody, dropoff: PointBody, options: Options });
const OrderBody = z.object({
  quoteId: z.uuid(),
  class: z.enum(RIDE_CLASSES),
  paymentMethod: z.enum(['cash', 'card']).default('cash'),
  pickup: PlaceText,
  dropoff: PlaceText,
  comment: Comment,
  clientRequestId: z.uuid(),
});
const PhoneOrderBody = z.object({
  riderPhone: UzPhone,
  riderName: z.string().trim().min(1).max(100).nullable().default(null),
  pickup: PlaceBody,
  dropoff: PlaceBody,
  class: z.enum(RIDE_CLASSES).default('economy'),
  options: Options,
  comment: Comment,
});
const Cursor = z.object({ cursor: z.uuid().optional() });
const RiderCancelBody = z.object({
  reason: z.string().trim().min(1).max(300).nullable().default(null),
});
const DriverCancelBody = z.object({
  reasonCode: z.enum(
    Object.keys(DRIVER_CANCEL_REASONS) as [DriverCancelReason, ...DriverCancelReason[]],
  ),
  note: z.string().trim().min(1).max(200).nullable().default(null),
});
const OperatorCancelBody = z.object({ reason: z.string().trim().min(3).max(300) });
const AssignBody = z.object({ driverId: z.uuid() });
const AdminListQuery = z.object({
  status: z.enum([...RIDE_STATUSES, 'open']).optional(),
  q: z.string().trim().min(1).max(20).optional(),
});
const TariffQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

@Controller('rides')
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  /** Fixed prices for a trip in every class, valid for 10 minutes. */
  @Post('quote')
  @RateLimit({ name: 'rides:quote', by: 'user', max: 30, windowSeconds: 60 })
  @HttpCode(HttpStatus.OK)
  quote(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(QuoteBody)) body: z.output<typeof QuoteBody>,
  ) {
    return this.rides.quote(user, body);
  }

  /** Orders a quoted ride: 201 for a new ride, 200 when the clientRequestId was seen before. */
  @Post()
  @RateLimit({ name: 'rides:order', by: 'user', max: 10, windowSeconds: 60 })
  async order(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(OrderBody)) body: z.output<typeof OrderBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.rides.order(user, body);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.ride;
  }

  @Get()
  history(@CurrentUser() user: AuthUser, @Query(new ZodPipe(Cursor)) q: z.output<typeof Cursor>) {
    return this.rides.riderHistory(user, q.cursor);
  }

  /** The rider's open ride, or null. */
  @Get('current')
  async current(@CurrentUser() user: AuthUser) {
    return { ride: await this.rides.riderCurrent(user) };
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.riderView(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RiderCancelBody)) body: z.output<typeof RiderCancelBody>,
  ) {
    return this.rides.cancelByRider(user, id, body.reason);
  }

  /** A share-trip link for family: live position until the ride ends. */
  @Post(':id/share')
  @HttpCode(HttpStatus.OK)
  share(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.share(user, id);
  }
}

@Controller('tariffs')
export class TariffsController {
  constructor(
    private readonly geo: GeoService,
    private readonly payments: PaymentsService,
  ) {}

  /** The published tariff where a ride would start (prices are public and fixed). */
  @Public()
  @RateLimit({ name: 'tariffs', by: 'ip', max: 120, windowSeconds: 60 })
  @Get()
  async tariff(@Query(new ZodPipe(TariffQuery)) q: z.output<typeof TariffQuery>) {
    const service = await this.geo.serviceCity(q);
    return service
      ? {
          serviceable: true,
          cityId: service.city.id,
          city: service.city.nameUz,
          tariff: service.tariff,
          paymentMethods: this.payments.methods(),
          cardProviders: this.payments.providers(),
        }
      : { serviceable: false, cityId: null, city: null, tariff: null, paymentMethods: [] };
  }
}

@Controller('driver/rides')
export class DriverRidesController {
  constructor(private readonly rides: RidesService) {}

  /** The driver's ride in progress (assigned, arrived or on the way), or null. */
  @Get('current')
  async current(@CurrentUser() user: AuthUser) {
    return { ride: await this.rides.driverCurrent(user) };
  }

  @Get()
  history(@CurrentUser() user: AuthUser, @Query(new ZodPipe(Cursor)) q: z.output<typeof Cursor>) {
    return this.rides.driverHistory(user, q.cursor);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.driverView(user, id);
  }

  @Post(':id/arrive')
  @HttpCode(HttpStatus.OK)
  arrive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.arrive(user, id);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.start(user, id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.complete(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(DriverCancelBody)) body: z.output<typeof DriverCancelBody>,
  ) {
    await this.rides.cancelByDriver(user, id, body.reasonCode, body.note);
  }
}

@Controller('admin/rides')
@AdminOnly()
export class AdminRidesController {
  constructor(private readonly rides: RidesService) {}

  /** Prices a caller's trip before ordering it for them. */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(QuoteBody)) body: z.output<typeof QuoteBody>,
  ) {
    return this.rides.quote(user, body);
  }

  /** A phone order for a caller without the app. */
  @Post()
  phoneOrder(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PhoneOrderBody)) body: z.output<typeof PhoneOrderBody>,
  ) {
    return this.rides.phoneOrder(user, body);
  }

  @Get()
  list(@Query(new ZodPipe(AdminListQuery)) q: z.output<typeof AdminListQuery>) {
    return this.rides.adminList(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.rides.adminView(id);
  }

  /** Gives the ride to a chosen driver (or moves it to another one). */
  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(AssignBody)) body: z.output<typeof AssignBody>,
  ) {
    return this.rides.assignByOperator(user, id, body.driverId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(OperatorCancelBody)) body: z.output<typeof OperatorCancelBody>,
  ) {
    return this.rides.cancelByOperator(user, id, body.reason);
  }
}

@Module({
  imports: [GeoCoreModule, BillingModule, PaymentsCoreModule],
  controllers: [RidesController, TariffsController, DriverRidesController, AdminRidesController],
  providers: [RidesService],
  exports: [RidesService],
})
export class RidesModule {}
