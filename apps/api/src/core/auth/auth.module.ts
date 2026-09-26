import { Body, Controller, Get, HttpCode, HttpStatus, Module, Patch, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { Database } from '../db/database.js';
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
const UpdateMeBody = z.object({ fullName: z.string().trim().min(1).max(100) });

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
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @Body(new ZodPipe(VerifyCodeBody)) body: z.output<typeof VerifyCodeBody>,
    @Meta() meta: RequestMeta,
  ) {
    return this.auth.verifyCode(body.phone, body.code, body.client, meta);
  }

  @Public()
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
    const driver = await this.db.kysely
      .selectFrom('drivers')
      .select(['status', 'status_reason as statusReason', 'is_online as isOnline'])
      .where('user_id', '=', user.userId)
      .executeTakeFirst();
    return {
      id: user.userId,
      phone: user.phone,
      fullName: user.fullName,
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
    await this.db.kysely
      .updateTable('users')
      .set({ full_name: body.fullName })
      .where('id', '=', user.userId)
      .execute();
    return this.me({ ...user, fullName: body.fullName });
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
