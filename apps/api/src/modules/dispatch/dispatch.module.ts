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
} from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { GeoCoreModule } from '../geo/geo-core.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { DispatchHandler } from './dispatch.handler.js';
import { DispatchJob } from './dispatch.job.js';
import { DispatchService } from './dispatch.service.js';

/** Reasons the driver app offers when letting a ride pass (free text is fine too). */
export const DECLINE_REASONS = {
  too_far: 'Juda uzoq',
  destination: 'Bu tomonga bormayman',
  rider_rating: 'Yo‘lovchi reytingi past',
  car_not_suitable: 'Avtomobil mos emas',
  break: 'Dam olyapman',
  other: 'Boshqa sabab',
} as const;
const DeclineBody = z
  .object({ reason: z.string().trim().min(1).max(200).nullable().default(null) })
  .default({ reason: null });

@Controller('driver/offers')
export class DriverOffersController {
  constructor(private readonly dispatch: DispatchService) {}

  /** Offers waiting for this driver's answer (the app also hears about them in realtime). */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.dispatch.offers(user);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dispatch.accept(user, id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  async decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(DeclineBody)) body: z.output<typeof DeclineBody>,
  ) {
    await this.dispatch.decline(user, id, body.reason);
  }
}

@Controller('admin/dispatch')
@AdminOnly()
export class AdminDispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  /** Online drivers (free / offered / busy) with positions, and every open ride. */
  @Get('live')
  live() {
    return this.dispatch.live();
  }

  /** Who could take a waiting ride, best road ETA first, for manual assignment. */
  @Get('rides/:id/candidates')
  candidates(@Param('id', ParseUUIDPipe) id: string) {
    return this.dispatch.candidates(id);
  }
}

@Module({
  imports: [RidesModule, GeoCoreModule],
  controllers: [DriverOffersController, AdminDispatchController],
  providers: [DispatchService, DispatchHandler, DispatchJob],
  exports: [DispatchService, DispatchHandler, DispatchJob],
})
export class DispatchModule {}
