import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Patch,
  Post,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { Database } from '../db/database.js';
import { RateLimit } from '../http/rate-limit.js';
import { ZodPipe } from '../http/zod.pipe.js';
import { type AuthUser, CurrentUser, Meta, Public, type RequestMeta } from './auth-context.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { UzPhone } from './phone.js';
import { TokenService } from './tokens.js';

const RequestCodeBody = z.object({ phone: UzPhone });
const VerifyCodeBody = z.object({
  phone: UzPhone,
  code: z.string().regex(/^\d{6}$/, '6 ta raqam'),
  client: z.enum(['rider', 'driver', 'admin']),
});
const RefreshBody = z.object({ refreshToken: z.string().min(1).max(200) });
const UpdateMeBody = z
  .object({
    // one space between words: a keyboard's double space showed on the driver's screen
    fullName: z
      .string()
      .transform((s) => s.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(1).max(100)),
    /** Self-declared; the female-driver option is offered to women. */
    gender: z.enum(['female', 'male']),
  })
  .partial()
  .refine((b) => b.fullName !== undefined || b.gender !== undefined, 'O‘zgartirish yo‘q');

/** A declared gender can be changed once in this many days (the female-driver option). */
export const GENDER_CHANGE_DAYS = 30;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('code')
  @HttpCode(HttpStatus.ACCEPTED)
  requestCode(
    @Body(new ZodPipe(RequestCodeBody)) body: z.output<typeof RequestCodeBody>,
    @Meta() meta: RequestMeta,
  ) {
    return this.auth.requestCode(body.phone, meta);
  }

  @Public()
  @RateLimit({ name: 'auth:verify', by: 'ip', max: 100, windowSeconds: 600 })
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @Body(new ZodPipe(VerifyCodeBody)) body: z.output<typeof VerifyCodeBody>,
    @Meta() meta: RequestMeta,
  ) {
    return this.auth.verifyCode(body.phone, body.code, body.client, meta);
  }

  @Public()
  // generous: mobile carriers put many phones behind one address (CGNAT)
  @RateLimit({ name: 'auth:refresh', by: 'ip', max: 300, windowSeconds: 60 })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodPipe(RefreshBody)) body: z.output<typeof RefreshBody>,
    @Meta() meta: RequestMeta,
  ) {
    return this.auth.refresh(body.refreshToken, meta);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body(new ZodPipe(RefreshBody)) body: z.output<typeof RefreshBody>) {
    await this.auth.logout(body.refreshToken);
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly db: Database) {}

  /** The account and every role it holds, so each app knows what to show. */
  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const [driver, account] = await Promise.all([
      this.db.kysely
        .selectFrom('drivers')
        .select(['status', 'status_reason as statusReason', 'is_online as isOnline'])
        .where('user_id', '=', user.userId)
        .executeTakeFirst(),
      this.db.kysely
        .selectFrom('users')
        .select(['gender', 'gender_set_at'])
        .where('id', '=', user.userId)
        .executeTakeFirst(),
    ]);
    return {
      id: user.userId,
      phone: user.phone,
      fullName: user.fullName,
      gender: account?.gender ?? null,
      // when the declared gender may be changed again (null: now)
      genderLockedUntil:
        account?.gender_set_at &&
        account.gender_set_at.getTime() + GENDER_CHANGE_DAYS * 86_400_000 > Date.now()
          ? new Date(account.gender_set_at.getTime() + GENDER_CHANGE_DAYS * 86_400_000)
          : null,
      isAdmin: user.isAdmin,
      // every account can ride; driving needs an approved application
      driver: driver ?? null,
    };
  }

  @Patch()
  async update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(UpdateMeBody)) body: z.output<typeof UpdateMeBody>,
  ) {
    const current = await this.db.kysely
      .selectFrom('users')
      .select(['gender', 'gender_set_at'])
      .where('id', '=', user.userId)
      .executeTakeFirstOrThrow();
    const genderChanges = body.gender !== undefined && body.gender !== current.gender;
    // switching back and forth to reach women drivers is abuse: once a month at most
    if (
      genderChanges &&
      current.gender &&
      current.gender_set_at &&
      Date.now() - current.gender_set_at.getTime() < GENDER_CHANGE_DAYS * 86_400_000
    ) {
      throw new ConflictException(
        `Jinsni ${GENDER_CHANGE_DAYS} kunda bir marta o‘zgartirish mumkin`,
      );
    }
    if (body.fullName !== undefined || genderChanges) {
      await this.db.kysely
        .updateTable('users')
        .set({
          ...(body.fullName !== undefined ? { full_name: body.fullName } : {}),
          ...(genderChanges ? { gender: body.gender!, gender_set_at: new Date() } : {}),
        })
        .where('id', '=', user.userId)
        .execute();
    }
    return this.me({ ...user, fullName: body.fullName ?? user.fullName });
  }
}

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ secret: env.JWT_ACCESS_SECRET }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, TokenService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
