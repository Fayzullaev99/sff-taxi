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
} from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { DOCUMENT_KINDS, DRIVER_STATUSES, VEHICLE_FEATURES } from '../../core/db/schema.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { isUzPlate, normalizeLicenceNumber, normalizePlate } from '../../lib/driver-rules.js';
import { BillingModule } from '../billing/billing.module.js';
import { GeoCoreModule } from '../geo/geo-core.module.js';
import { type DriverDecision, DriversService } from './drivers.service.js';

const DateString = z.iso.date('Sana YYYY-MM-DD ko‘rinishida');
const Feature = z.enum(VEHICLE_FEATURES);

const VehicleBody = z.object({
  make: z.string().trim().min(2).max(40),
  model: z.string().trim().min(1).max(40),
  colour: z.string().trim().min(2).max(30),
  plate: z
    .string()
    .trim()
    .transform(normalizePlate)
    .refine(isUzPlate, 'Davlat raqami noto‘g‘ri, masalan 20 A 123 BC yoki 20 123 ABC'),
  year: z.number().int().min(1990).max(2100),
  seats: z.number().int().min(1).max(8),
  class: z.enum(['economy', 'comfort']).default('economy'),
  features: z.array(Feature).max(4).default([]),
});

const ApplicationBody = z.object({
  fullName: z.string().trim().min(3).max(100),
  birthDate: DateString,
  pinfl: z.string().regex(/^\d{14}$/, 'JShShIR 14 ta raqamdan iborat'),
  licenceNumber: z
    .string()
    .trim()
    .transform(normalizeLicenceNumber)
    .refine((v) => /^[A-Z]{2}\d{7}$/.test(v), 'Guvohnoma raqami noto‘g‘ri, masalan AF1234567'),
  licenceCategories: z
    .array(z.enum(['A', 'B', 'C', 'D', 'E', 'BE', 'CE', 'DE']))
    .min(1)
    .max(8),
  licenceIssuedOn: DateString,
  licenceCardNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, '').toUpperCase())
    .refine((v) => /^[A-Z0-9-]{5,30}$/.test(v), 'Litsenziya kartochkasi raqami noto‘g‘ri'),
  licenceCardExpiresOn: DateString,
  vehicle: VehicleBody,
});
const DocumentBody = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2000),
  expiresOn: DateString.nullable().default(null),
});
const DocumentKind = z.enum(DOCUMENT_KINDS);
const ShiftBody = z.object({ online: z.boolean() });
const LocationBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).max(1000).optional(),
});
const ListQuery = z.object({
  status: z.enum(DRIVER_STATUSES).optional(),
  q: z.string().trim().min(1).max(50).optional(),
});
const DecisionBody = z.object({
  reason: z.string().trim().min(3).max(500).nullable().default(null),
});
const VehiclePatch = z
  .object({ class: z.enum(['economy', 'comfort']), features: z.array(Feature).max(4) })
  .partial();

@Controller('driver')
export class DriverController {
  constructor(private readonly drivers: DriversService) {}

  /** Apply (or correct a pending/rejected application): personal data, licences and the car. */
  @Post('application')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(ApplicationBody)) body: z.output<typeof ApplicationBody>,
  ) {
    return this.drivers.apply(user, body);
  }

  @Put('documents/:kind')
  setDocument(
    @CurrentUser() user: AuthUser,
    @Param('kind', new ZodPipe(DocumentKind)) kind: z.output<typeof DocumentKind>,
    @Body(new ZodPipe(DocumentBody)) body: z.output<typeof DocumentBody>,
  ) {
    return this.drivers.setDocument(user, kind, body);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.drivers.me(user);
  }

  @Post('shift')
  @HttpCode(HttpStatus.OK)
  shift(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(ShiftBody)) body: z.output<typeof ShiftBody>,
  ) {
    return this.drivers.setOnline(user, body.online);
  }

  @Post('location')
  @HttpCode(HttpStatus.NO_CONTENT)
  async location(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(LocationBody)) body: z.output<typeof LocationBody>,
  ) {
    await this.drivers.locate(user, body);
  }
}

@Controller('admin/drivers')
@AdminOnly()
export class AdminDriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  list(@Query(new ZodPipe(ListQuery)) q: z.output<typeof ListQuery>) {
    return this.drivers.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.adminView(id);
  }

  /** approve | reject | block | unblock, with a reason (required except for approval). */
  @Post(':id/:decision')
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decision', new ZodPipe(z.enum(['approve', 'reject', 'block', 'unblock'])))
    decision: DriverDecision,
    @Body(new ZodPipe(DecisionBody)) body: z.output<typeof DecisionBody>,
  ) {
    return this.drivers.decide(user, id, decision, body.reason);
  }

  @Patch(':id/vehicle')
  updateVehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(VehiclePatch)) body: z.output<typeof VehiclePatch>,
  ) {
    return this.drivers.updateVehicle(id, body);
  }
}

@Module({
  imports: [GeoCoreModule, BillingModule],
  controllers: [DriverController, AdminDriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
