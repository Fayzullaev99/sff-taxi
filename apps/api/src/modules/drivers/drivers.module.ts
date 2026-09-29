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
import { CARGO_CLASSES, VEHICLE_BODIES } from '../../lib/cargo.js';
import { BillingModule } from '../billing/billing.module.js';
import { GeoCoreModule } from '../geo/geo-core.module.js';
import { RealtimeBus } from '../realtime/realtime.publisher.js';
import { type DriverDecision, DriversService } from './drivers.service.js';
import { createLicenceRegistry, LICENCE_REGISTRY } from './licence-registry.js';
import { ENV, type Env } from '../../config/env.js';

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
  /** A CNG tank in the trunk (many Cobalts/Nexias): no luggage rides even with a big trunk. */
  cngInTrunk: z.boolean().default(false),
  /**
   * taxi: a passenger car (Resolution 200: no vans, <= 4 seats, <= 15 years); cargo: a van,
   * pickup or truck (Damas, Labo, Gazel, Porter) for cargo rides only (<= 25 years, payload).
   */
  service: z.enum(['taxi', 'cargo']).default('taxi'),
  body: z.enum(VEHICLE_BODIES).optional(),
  /** Cargo cars: how much it loads (kg); up to 800 kg it is a small car, above medium. */
  payloadKg: z.number().int().min(1).max(20_000).nullable().default(null),
  /** Total (gross) mass, kg: above 3 500 a category C licence is needed. */
  grossKg: z.number().int().min(500).max(40_000).nullable().default(null),
});

const ApplicationBody = z.object({
  fullName: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(3).max(100)),
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
  /** As in the passport; verified by an operator. */
  gender: z.enum(['female', 'male']).optional(),
  vehicle: VehicleBody,
});
const DocumentBody = z
  .object({
    /** A ready upload (POST /uploads, purpose document): the way to send documents. */
    uploadId: z.uuid().optional(),
    /** Deprecated: a URL hosted elsewhere, for apps built before uploads. */
    url: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .optional(),
    expiresOn: DateString.nullable().default(null),
  })
  .refine((b) => (b.uploadId === undefined) !== (b.url === undefined), {
    message: 'uploadId yoki url dan bittasini yuboring',
    path: ['uploadId'],
  });
const PhotoBody = z.object({ uploadId: z.uuid() });
const DocumentKind = z.enum(DOCUMENT_KINDS);
const ShiftBody = z.object({ online: z.boolean() });
const PreferencesBody = z
  .object({
    poolEnabled: z.boolean(),
    extraPassengers: z.number().int().min(0).max(3),
    destination: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        address: z.string().trim().max(300).nullable().default(null),
      })
      .nullable(),
    womenRidersOnly: z.boolean(),
  })
  .partial();
const GenderBody = z.object({ gender: z.enum(['female', 'male']) });
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
  .object({
    class: z.enum(['economy', 'comfort']),
    features: z.array(Feature).max(4),
    cngInTrunk: z.boolean(),
    /** Cargo cars only. */
    payloadKg: z.number().int().min(1).max(20_000),
    cargoClass: z.enum(CARGO_CLASSES),
  })
  .partial();
const AppealBody = z.object({ text: z.string().trim().min(5).max(1000) });
const LicenceCheckBody = z.object({
  result: z.enum(['valid', 'invalid']),
  /** What was checked, where: "Transport vazirligi reyestri, 27.09 tekshirildi". */
  note: z.string().trim().min(3).max(500),
  expiresOn: DateString.nullable().default(null),
});
const AppealsQuery = z.object({ status: z.enum(['open', 'resolved']).default('open') });
const ResolveAppealBody = z.object({ resolution: z.string().trim().min(3).max(1000) });

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

  /** The driver's face riders see (an upload with purpose profile_photo). */
  @Put('photo')
  setPhoto(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PhotoBody)) body: z.output<typeof PhotoBody>,
  ) {
    return this.drivers.setPhoto(user, 'driver', body.uploadId);
  }

  /** The car as riders see it (an upload with purpose vehicle_photo). */
  @Put('vehicle/photo')
  setVehiclePhoto(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PhotoBody)) body: z.output<typeof PhotoBody>,
  ) {
    return this.drivers.setPhoto(user, 'vehicle', body.uploadId);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.drivers.me(user);
  }

  /** A rejected or blocked driver asks operators to review the decision. */
  @Post('appeals')
  appeal(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(AppealBody)) body: z.output<typeof AppealBody>,
  ) {
    return this.drivers.appeal(user, body.text);
  }

  @Get('appeals')
  appeals(@CurrentUser() user: AuthUser) {
    return this.drivers.appeals(user.userId);
  }

  @Post('shift')
  @HttpCode(HttpStatus.OK)
  shift(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(ShiftBody)) body: z.output<typeof ShiftBody>,
  ) {
    return this.drivers.setOnline(user, body.online);
  }

  /**
   * Shared rides and filters: "Boshqa yo‘lovchi olaman", people in the car without the app,
   * where the driver is heading (offers only on the way), women riders only.
   */
  @Put('preferences')
  preferences(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PreferencesBody)) body: z.output<typeof PreferencesBody>,
  ) {
    return this.drivers.setPreferences(user, body);
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

  /** Appeals of rejected and blocked drivers, oldest open first. */
  @Get('appeals')
  appealsList(@Query(new ZodPipe(AppealsQuery)) q: z.output<typeof AppealsQuery>) {
    return this.drivers.appealQueue(q.status);
  }

  /**
   * Answers an appeal (the driver sees the answer). Changing the decision itself is a
   * separate unblock / re-review action.
   */
  @Post('appeals/:appealId/resolve')
  @HttpCode(HttpStatus.OK)
  resolveAppeal(
    @CurrentUser() user: AuthUser,
    @Param('appealId', ParseUUIDPipe) appealId: string,
    @Body(new ZodPipe(ResolveAppealBody)) body: z.output<typeof ResolveAppealBody>,
  ) {
    return this.drivers.resolveAppeal(user, appealId, body.resolution);
  }

  /** Card money owed per driver (card fares minus payouts), most owed first. */
  @Get('payouts')
  payouts() {
    return this.drivers.payouts();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.adminView(id);
  }

  /**
   * Records the licence card check an operator made in the Ministry of Transport's registry
   * (the manual registry). Approval and going online need a valid card.
   */
  @Post(':id/licence')
  @HttpCode(HttpStatus.OK)
  checkLicence(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(LicenceCheckBody)) body: z.output<typeof LicenceCheckBody>,
  ) {
    return this.drivers.recordLicenceCheck(user, id, body);
  }

  /** The gender as checked in the passport (women riders may ask for a woman driver). */
  @Post(':id/gender')
  @HttpCode(HttpStatus.OK)
  verifyGender(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(GenderBody)) body: z.output<typeof GenderBody>,
  ) {
    return this.drivers.verifyGender(user, id, body.gender);
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
  providers: [
    DriversService,
    RealtimeBus,
    {
      provide: LICENCE_REGISTRY,
      inject: [ENV],
      useFactory: (env: Env) => createLicenceRegistry(env),
    },
  ],
  exports: [DriversService],
})
export class DriversModule {}
