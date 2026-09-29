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
import { RIDE_SERVICES, RIDE_STATUSES } from '../../core/db/schema.js';
import { CARGO_CLASSES } from '../../lib/cargo.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { REASON_LABELS } from '../../lib/reasons.js';
import { RIDE_CLASSES, RIDE_OPTIONS } from '../../lib/tariff.js';
import { BillingModule } from '../billing/billing.module.js';
import { FiscalCoreModule } from '../fiscal/fiscal.module.js';
import { GeoCoreModule } from '../geo/geo-core.module.js';
import { GeoService } from '../geo/geo.service.js';
import { PaymentsCoreModule } from '../payments/payments.module.js';
import { PaymentsService } from '../payments/payments.service.js';
import { AvailabilityService } from './availability.service.js';
import { PoolService } from './pool.service.js';
import { DRIVER_CANCEL_REASONS, type DriverCancelReason, RidesService } from './rides.service.js';

const Lat = z.number().min(-90).max(90);
const Lng = z.number().min(-180).max(180);
const PointBody = z.object({ lat: Lat, lng: Lng });
const Address = z.string().trim().min(1).max(300).nullable().default(null);
const Landmark = z.string().trim().min(1).max(200).nullable().default(null);
const PlaceText = z
  .object({ address: Address, landmark: Landmark })
  .default({ address: null, landmark: null });
const Options = z.array(z.enum(RIDE_OPTIONS)).max(4).default([]);
const Comment = z.string().trim().min(1).max(500).nullable().default(null);

const LoadText = z.string().trim().min(1).max(300).nullable().default(null);
const QuoteBody = z.object({
  pickup: PointBody,
  dropoff: PointBody,
  options: Options,
  /** taxi (default), cargo ("Yuk tashish") or delivery (a parcel carried by a taxi car). */
  service: z.enum(RIDE_SERVICES).default('taxi'),
  /** Cargo: loaders ("yukchi") are priced; the customer may ride in the cab (one person). */
  cargo: z
    .object({
      loaders: z.number().int().min(0).max(4).default(0),
      riderRides: z.boolean().default(false),
      description: LoadText,
      weightKg: z.number().int().min(1).max(20_000).nullable().default(null),
    })
    .optional(),
  /** Delivery: a small parcel (the weight limit is a setting, 10 kg by default). */
  parcel: z
    .object({
      description: LoadText,
      weightKg: z.number().int().min(1).max(50).nullable().default(null),
    })
    .optional(),
  /** Order for later: 30 minutes to 24 hours ahead, cash (dispatch starts 15 min before). */
  scheduledFor: z.iso
    .datetime({ offset: true })
    .transform((v) => new Date(v))
    .nullable()
    .default(null),
});
const OrderBody = z.object({
  quoteId: z.uuid(),
  /** economy/comfort (taxi, delivery) or cargo_s/cargo_m (a cargo quote). */
  class: z.enum([...RIDE_CLASSES, ...CARGO_CLASSES]),
  /** Cargo: the load described more precisely than in the quote (the price stays). */
  cargo: z
    .object({
      description: LoadText.optional(),
      weightKg: z.number().int().min(1).max(20_000).nullable().optional(),
    })
    .optional(),
  /** Delivery: the parcel and who receives it (required for a delivery). */
  parcel: z
    .object({
      description: LoadText.optional(),
      weightKg: z.number().int().min(1).max(50).nullable().optional(),
    })
    .optional(),
  recipient: z
    .object({ name: z.string().trim().min(1).max(100), phone: UzPhone })
    .nullable()
    .default(null),
  paymentMethod: z.enum(['cash', 'card']).default('cash'),
  pickup: PlaceText,
  dropoff: PlaceText,
  comment: Comment,
  clientRequestId: z.uuid(),
  /** People riding: one in front, at most two in the back. */
  passengers: z.number().int().min(1).max(3).default(1),
  /** "Hamroh bilan": riders going the same way may share the car (cash, a discount). */
  shareable: z.boolean().default(false),
  /** A woman driver only (riders who declared themselves women). */
  womenOnly: z.boolean().default(false),
  /** car: the whole car; seat: the fixed route's per-person price in a shared car. */
  fareMode: z.enum(['car', 'seat']).default('car'),
});
// coordinates may be left out when the operator's quote gives them
const PhonePlace = z.object({
  lat: Lat.optional(),
  lng: Lng.optional(),
  address: Address,
  landmark: Landmark,
});
const PhoneOrderBody = z.object({
  riderPhone: UzPhone,
  riderName: z.string().trim().min(1).max(100).nullable().default(null),
  pickup: PhonePlace,
  dropoff: PhonePlace,
  class: z.enum(RIDE_CLASSES).default('economy'),
  options: Options,
  comment: Comment,
  /** POST admin/rides/quote: the fare read out to the caller is the fare of the ride. */
  quoteId: z.uuid().nullable().default(null),
  /** The panel's idempotency key: a repeated request returns the same ride (200). */
  clientRequestId: z.uuid().nullable().default(null),
  passengers: z.number().int().min(1).max(3).default(1),
});
const LookupBody = z.object({ phone: UzPhone });
const DayString = z.iso.date('Sana YYYY-MM-DD ko‘rinishida');
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
const StartBody = z
  .object({
    pin: z
      .string()
      .regex(/^\d{4}$/, '4 xonali kod')
      .nullable()
      .default(null),
  })
  .default({ pin: null });
const OperatorCancelBody = z.object({ reason: z.string().trim().min(3).max(300) });
const AssignBody = z.object({ driverId: z.uuid() });
const WaiveBody = z.object({ note: z.string().trim().min(3).max(300) });
const AdminListQuery = z.object({
  status: z.enum([...RIDE_STATUSES, 'open', 'all']).optional(),
  q: z.string().trim().min(1).max(20).optional(),
  driverId: z.uuid().optional(),
  riderId: z.uuid().optional(),
  class: z.enum([...RIDE_CLASSES, ...CARGO_CLASSES]).optional(),
  service: z.enum(RIDE_SERVICES).optional(),
  from: DayString.optional(),
  to: DayString.optional(),
  /** The last id of the previous page. */
  cursor: z.uuid().optional(),
});
const DriverRidesQuery = AdminListQuery.omit({ driverId: true });
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

  /** The rider's rides for later, soonest first. */
  @Get('scheduled')
  scheduled(@CurrentUser() user: AuthUser) {
    return this.rides.riderScheduled(user);
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
  start(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(StartBody)) body: z.output<typeof StartBody>,
  ) {
    return this.rides.start(user, id, body.pin);
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

  /**
   * Prices a caller's trip before ordering it for them; with scheduledFor (30 min to 24 h
   * ahead) the phone order made with this quote is a ride for later.
   */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(QuoteBody)) body: z.output<typeof QuoteBody>,
  ) {
    return this.rides.quote(user, body, new Date(), { forRider: false });
  }

  /** A phone order for a caller without the app: 201, or 200 for a repeated clientRequestId. */
  @Post()
  async phoneOrder(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PhoneOrderBody)) body: z.output<typeof PhoneOrderBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.rides.phoneOrder(user, body);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.ride;
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

  /** Lets the rider off this ride's owed cancellation fee (a ride carrying it collects less). */
  @Post(':id/fee/waive')
  @HttpCode(HttpStatus.OK)
  waiveFee(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(WaiveBody)) body: z.output<typeof WaiveBody>,
  ) {
    return this.rides.waiveFee(user, id, body.note);
  }
}

/** Operators: the reason codes drivers send, with their Uzbek labels (the panel's mapping). */
@Controller('admin/reasons')
@AdminOnly()
export class AdminReasonsController {
  @Get()
  list() {
    return REASON_LABELS;
  }
}

/** Operators: who is calling (phone orders). */
@Controller('admin/customers')
@AdminOnly()
export class AdminCustomersController {
  constructor(private readonly rides: RidesService) {}

  /** POST, not GET: the phone stays out of URLs and logs. */
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  lookup(@Body(new ZodPipe(LookupBody)) body: z.output<typeof LookupBody>) {
    return this.rides.customerLookup(body.phone);
  }
}

/** Operators: a driver's rides (same filters as the ride list). */
@Controller('admin/drivers')
@AdminOnly()
export class AdminDriverRidesController {
  constructor(private readonly rides: RidesService) {}

  @Get(':id/rides')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(DriverRidesQuery)) q: z.output<typeof DriverRidesQuery>,
  ) {
    return this.rides.adminList({ status: 'all', ...q, driverId: id });
  }
}

@Module({
  imports: [GeoCoreModule, BillingModule, PaymentsCoreModule, FiscalCoreModule],
  controllers: [
    RidesController,
    TariffsController,
    DriverRidesController,
    AdminRidesController,
    AdminCustomersController,
    AdminDriverRidesController,
    AdminReasonsController,
  ],
  providers: [RidesService, AvailabilityService, PoolService],
  exports: [RidesService, PoolService],
})
export class RidesModule {}
