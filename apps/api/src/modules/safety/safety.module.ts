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
} from '@nestjs/common';
import { z } from 'zod';
import {
  AdminOnly,
  type AuthUser,
  CurrentUser,
  Meta,
  Public,
  type RequestMeta,
} from '../../core/auth/auth-context.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { RateLimiter } from '../../core/redis/rate-limiter.js';
import { GeoCoreModule } from '../geo/geo-core.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { SafetyService } from './safety.service.js';

const RatingBody = z.object({
  stars: z.number().int().min(1).max(5),
  tags: z.array(z.string().trim().min(1).max(30)).max(5).default([]),
  comment: z.string().trim().min(1).max(500).nullable().default(null),
});
const SosBody = z.object({
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  note: z.string().trim().min(1).max(500).nullable().default(null),
});
const SosQuery = z.object({ open: z.enum(['true', 'false']).default('true') });
const ResolveBody = z.object({ note: z.string().trim().min(3).max(500) });
const Token = z.string().regex(/^[\w-]{24}$/, 'Havola noto‘g‘ri');

@Controller('rides')
export class RiderSafetyController {
  constructor(private readonly safety: SafetyService) {}

  /** The rider rates the driver (1-5 stars) after a completed ride. */
  @Post(':id/rating')
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RatingBody)) body: z.output<typeof RatingBody>,
  ) {
    return this.safety.rate(user, id, 'rider', body);
  }

  @Post(':id/sos')
  sos(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SosBody)) body: z.output<typeof SosBody>,
  ) {
    return this.safety.sos(user, id, 'rider', body);
  }
}

@Controller('driver/rides')
export class DriverSafetyController {
  constructor(private readonly safety: SafetyService) {}

  /** The driver rates the rider after a completed ride. */
  @Post(':id/rating')
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RatingBody)) body: z.output<typeof RatingBody>,
  ) {
    return this.safety.rate(user, id, 'driver', body);
  }

  @Post(':id/sos')
  sos(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SosBody)) body: z.output<typeof SosBody>,
  ) {
    return this.safety.sos(user, id, 'driver', body);
  }
}

@Controller('share')
export class ShareController {
  constructor(
    private readonly safety: SafetyService,
    private readonly limiter: RateLimiter,
  ) {}

  /** A share-trip link, opened by family without an account. */
  @Public()
  @Get(':token')
  async shared(@Param('token', new ZodPipe(Token)) token: string, @Meta() meta: RequestMeta) {
    await this.limiter.consume({
      name: 'share:ip',
      subject: meta.ip ?? 'unknown',
      max: 120,
      windowSeconds: 60,
      perIp: true,
    });
    return this.safety.shared(token);
  }
}

@Controller('admin/sos')
@AdminOnly()
export class AdminSosController {
  constructor(private readonly safety: SafetyService) {}

  @Get()
  list(@Query(new ZodPipe(SosQuery)) q: z.output<typeof SosQuery>) {
    return this.safety.sosList(q.open === 'true');
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ResolveBody)) body: z.output<typeof ResolveBody>,
  ) {
    return this.safety.resolveSos(user, id, body.note);
  }
}

@Module({
  imports: [RidesModule, GeoCoreModule],
  controllers: [RiderSafetyController, DriverSafetyController, ShareController, AdminSosController],
  providers: [SafetyService],
})
export class SafetyModule {}
