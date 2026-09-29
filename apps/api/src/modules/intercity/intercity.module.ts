import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AdminOnly, type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { UzPhone } from '../../core/auth/phone.js';
import { TRIP_STATUSES } from '../../core/db/schema.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { BillingModule } from '../billing/billing.module.js';
import { GeoCoreModule } from '../geo/geo-core.module.js';
import { PaymentsCoreModule } from '../payments/payments.module.js';
import { IntercityService } from './intercity.service.js';

const PointRef = z.string().trim().min(2).max(40);
const DateString = z.iso.date('Sana YYYY-MM-DD ko‘rinishida');
const Cursor = z.object({ cursor: z.uuid().optional() });
const Reason = z.string().trim().min(3).max(300);

const FareQuery = z.object({
  from: PointRef,
  to: PointRef,
  class: z.enum(['economy', 'comfort']).default('economy'),
});
const SearchQuery = z.object({
  from: PointRef,
  to: PointRef,
  date: DateString.optional(),
  seats: z.coerce.number().int().min(1).max(4).default(1),
  /** false: only trips between exactly these towns, not those passing them (along the way). */
  along: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});
const PublishBody = z.object({
  from: PointRef,
  to: PointRef,
  departureAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  seats: z.number().int().min(1).max(4),
  /** Whether the front seat is among the seats offered (it is sold at the front price). */
  frontSeat: z.boolean().default(true),
  /** Rear seat price within the band (GET driver/intercity/fares); the reference when null. */
  priceRear: z.number().int().min(1000).max(2_000_000).nullable().default(null),
  meetingPoint: z.string().trim().min(3).max(200).nullable().default(null),
  comment: z.string().trim().min(1).max(500).nullable().default(null),
});
/** A seat along the way: the rider's own towns (as the search found it); the trip's ends when left out. */
const PartOfTrip = {
  from: PointRef.nullable().default(null),
  to: PointRef.nullable().default(null),
};
const BookBody = z.object({
  // the seating rule (at most 3) is checked by the service, with its message
  seats: z.number().int().min(1).max(4).default(1),
  front: z.boolean().default(false),
  pickupNote: z.string().trim().min(1).max(300).nullable().default(null),
  clientRequestId: z.uuid(),
  ...PartOfTrip,
});
const PhoneBookBody = z.object({
  riderPhone: UzPhone,
  riderName: z.string().trim().min(1).max(100).nullable().default(null),
  seats: z.number().int().min(1).max(4).default(1),
  front: z.boolean().default(false),
  pickupNote: z.string().trim().min(1).max(300).nullable().default(null),
  /** The panel's idempotency key: a repeated request returns the same booking (200). */
  clientRequestId: z.uuid().nullable().default(null),
  ...PartOfTrip,
});
const DriverTripsQuery = Cursor.extend({
  /** upcoming: not arrived or cancelled, soonest first; all: latest departure first. */
  scope: z.enum(['all', 'upcoming']).default('all'),
});
// no defaults: a field left out stays as it is
const EditTripBody = z
  .object({
    departureAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    seats: z.number().int().min(1).max(4),
    frontSeat: z.boolean(),
    priceRear: z.number().int().min(1000).max(2_000_000).nullable(),
    meetingPoint: z.string().trim().min(3).max(200).nullable(),
    comment: z.string().trim().min(1).max(500).nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'O‘zgartirish uchun kamida bitta maydon yuboring');
const CancelBody = z.object({ reason: Reason.nullable().default(null) });
const OperatorCancelBody = z.object({ reason: Reason });
const AdminTripsQuery = z.object({
  status: z.enum(TRIP_STATUSES).optional(),
  date: DateString.optional(),
  from: PointRef.optional(),
  to: PointRef.optional(),
});
const RoutePriceBody = z.object({
  from: PointRef,
  to: PointRef,
  /** null removes the route price: the tariff decides again. */
  rear: z.number().int().min(1000).max(2_000_000).nullable(),
  front: z.number().int().min(1000).max(2_000_000).nullable(),
});

/** Riders: towns, reference prices, the board, bookings. */
@Controller('intercity')
export class IntercityController {
  constructor(private readonly intercity: IntercityService) {}

  /** Towns trips run between (Sirdaryo towns and Tashkent), with their meeting points. */
  @Get('points')
  points() {
    return this.intercity.points();
  }

  /** Seat prices of a route (reference; each trip shows its own). */
  @Get('fares')
  @RateLimit({ name: 'intercity:fares', by: 'user', max: 60, windowSeconds: 60 })
  fare(@Query(new ZodPipe(FareQuery)) q: z.output<typeof FareQuery>) {
    return this.intercity.fare(q.from, q.to, q.class);
  }

  /**
   * Open departures of a route on a date with at least `seats` free seats, then trips
   * passing both towns (`alongTheWay: true`, priced for the rider's part).
   */
  @Get('trips')
  @RateLimit({ name: 'intercity:search', by: 'user', max: 60, windowSeconds: 60 })
  search(@Query(new ZodPipe(SearchQuery)) q: z.output<typeof SearchQuery>) {
    return this.intercity.search(q);
  }

  @Get('trips/:id')
  trip(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.intercity.trip(user, id);
  }

  /**
   * Books seats: 201 for a new booking, 200 when the clientRequestId was seen before. With
   * deposits on, the booking is `awaiting_payment` until `payment.checkout` is paid.
   */
  @Post('trips/:id/bookings')
  @RateLimit({ name: 'intercity:book', by: 'user', max: 10, windowSeconds: 60 })
  async book(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(BookBody)) body: z.output<typeof BookBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.intercity.book(user, id, body);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.booking;
  }

  @Get('bookings')
  bookings(@CurrentUser() user: AuthUser, @Query(new ZodPipe(Cursor)) q: z.output<typeof Cursor>) {
    return this.intercity.riderBookings(user, q.cursor);
  }

  /** The booking with the driver's phone and the plate. */
  @Get('bookings/:id')
  booking(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.intercity.riderBooking(user, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(CancelBody)) body: z.output<typeof CancelBody>,
  ) {
    return this.intercity.cancelByRider(user, id, body.reason);
  }
}

/** Drivers: publish departures and run them. */
@Controller('driver/intercity')
export class DriverIntercityController {
  constructor(private readonly intercity: IntercityService) {}

  /** The reference seat price of a route for this car class and the band to price within. */
  @Get('fares')
  fare(@Query(new ZodPipe(FareQuery)) q: z.output<typeof FareQuery>) {
    return this.intercity.fare(q.from, q.to, q.class);
  }

  @Post('trips')
  publish(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PublishBody)) body: z.output<typeof PublishBody>,
  ) {
    return this.intercity.publish(user, body);
  }

  /** By departure: ?scope=upcoming (soonest first) or all (latest first, paged). */
  @Get('trips')
  trips(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(DriverTripsQuery)) q: z.output<typeof DriverTripsQuery>,
  ) {
    return this.intercity.driverTrips(user, q.cursor, q.scope);
  }

  /** Changes time, seats, price (within the band) and so on while nobody has booked. */
  @Patch('trips/:id')
  edit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(EditTripBody)) body: z.output<typeof EditTripBody>,
  ) {
    return this.intercity.editTrip(user, id, body);
  }

  /** The trip with the passenger list: names, phones, seats, pickup notes. */
  @Get('trips/:id')
  trip(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.intercity.driverTrip(user, id);
  }

  /** At the meeting point: passengers are told to come. */
  @Post('trips/:id/boarding')
  @HttpCode(HttpStatus.OK)
  boarding(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.intercity.boarding(user, id);
  }

  @Post('trips/:id/bookings/:bookingId/board')
  @HttpCode(HttpStatus.OK)
  board(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    return this.intercity.board(user, id, bookingId);
  }

  /** Leaves: passengers not aboard are no-shows. */
  @Post('trips/:id/depart')
  @HttpCode(HttpStatus.OK)
  depart(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.intercity.depart(user, id);
  }

  @Post('trips/:id/arrive')
  @HttpCode(HttpStatus.OK)
  arrive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.intercity.arrive(user, id);
  }

  @Post('trips/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(OperatorCancelBody)) body: z.output<typeof OperatorCancelBody>,
  ) {
    return this.intercity.cancelByDriver(user, id, body.reason);
  }
}

/** Operators: the board, bookings for callers, cancellations, route prices. */
@Controller('admin/intercity')
@AdminOnly()
export class AdminIntercityController {
  constructor(private readonly intercity: IntercityService) {}

  @Get('trips')
  trips(@Query(new ZodPipe(AdminTripsQuery)) q: z.output<typeof AdminTripsQuery>) {
    return this.intercity.adminTrips(q);
  }

  /** Open departures of a route, to offer a caller (same as the riders' board). */
  @Get('search')
  search(@Query(new ZodPipe(SearchQuery)) q: z.output<typeof SearchQuery>) {
    return this.intercity.search(q);
  }

  @Get('trips/:id')
  trip(@Param('id', ParseUUIDPipe) id: string) {
    return this.intercity.adminTrip(id);
  }

  /**
   * Books seats for a caller without the app; the caller gets the car and the driver by SMS.
   * 201 for a new booking, 200 when the clientRequestId was seen before.
   */
  @Post('trips/:id/bookings')
  async bookByPhone(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(PhoneBookBody)) body: z.output<typeof PhoneBookBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.intercity.bookByPhone(user, id, body);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.booking;
  }

  @Post('trips/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelTrip(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(OperatorCancelBody)) body: z.output<typeof OperatorCancelBody>,
  ) {
    return this.intercity.cancelByOperator(id, body.reason);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(OperatorCancelBody)) body: z.output<typeof OperatorCancelBody>,
  ) {
    return this.intercity.cancelBookingByOperator(id, body.reason);
  }

  @Get('fares')
  routePrices() {
    return this.intercity.routePrices();
  }

  @Put('fares')
  setRoutePrice(@Body(new ZodPipe(RoutePriceBody)) body: z.output<typeof RoutePriceBody>) {
    return this.intercity.setRoutePrice(
      body.from,
      body.to,
      body.rear === null || body.front === null ? null : { rear: body.rear, front: body.front },
    );
  }
}

/** The trip board's service, for the API and the worker (housekeeping). */
@Module({
  imports: [GeoCoreModule, BillingModule, PaymentsCoreModule],
  providers: [IntercityService],
  exports: [IntercityService],
})
export class IntercityCoreModule {}

@Module({
  imports: [IntercityCoreModule],
  controllers: [IntercityController, DriverIntercityController, AdminIntercityController],
  exports: [IntercityCoreModule],
})
export class IntercityModule {}
