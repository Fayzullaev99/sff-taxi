import { Body, Controller, Delete, HttpCode, HttpStatus, Module, Param, Put } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { Database } from '../../core/db/database.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { NotificationsHandler } from './notifications.handler.js';
import { Notifier } from './notifier.js';
import {
  ConsolePushProvider,
  EXPO_TOKEN,
  ExpoPushProvider,
  PUSH_PROVIDER,
  type PushProvider,
} from './push.provider.js';

function createPushProvider(env: Env): PushProvider {
  const kind = env.PUSH_PROVIDER ?? (env.NODE_ENV === 'production' ? 'expo' : 'console');
  return kind === 'expo'
    ? new ExpoPushProvider({ baseUrl: env.EXPO_PUSH_BASE_URL, accessToken: env.EXPO_ACCESS_TOKEN })
    : new ConsolePushProvider();
}

const DeviceBody = z.object({
  token: z.string().regex(EXPO_TOKEN, 'Expo push token kerak'),
  app: z.enum(['rider', 'driver']),
  platform: z.enum(['ios', 'android', 'web']),
  locale: z.enum(['uz', 'ru']).default('uz'),
});

@Controller('devices')
export class DevicesController {
  constructor(private readonly db: Database) {}

  /** Registers (or refreshes) this install's push token for the signed-in account. */
  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(DeviceBody)) body: z.output<typeof DeviceBody>,
  ) {
    const values = {
      user_id: user.userId,
      app: body.app,
      platform: body.platform,
      locale: body.locale,
      last_seen_at: new Date(),
    };
    // one install, one token: another account signing in on the phone takes it over
    await this.db.kysely
      .insertInto('push_devices')
      .values({ id: uuidv7(), token: body.token, ...values })
      .onConflict((oc) => oc.column('token').doUpdateSet(values))
      .execute();
  }

  /** On sign-out: this install stops receiving the account's notifications. */
  @Delete(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.db.kysely
      .deleteFrom('push_devices')
      .where('token', '=', token)
      .where('user_id', '=', user.userId)
      .execute();
  }
}

/** Push provider and the notifier, for the API and the worker. */
@Module({
  providers: [{ provide: PUSH_PROVIDER, inject: [ENV], useFactory: createPushProvider }, Notifier],
  exports: [PUSH_PROVIDER, Notifier],
})
export class NotificationsCoreModule {}

@Module({
  imports: [NotificationsCoreModule],
  controllers: [DevicesController],
})
export class NotificationsModule {}

/** The worker's notification sender (an outbox handler). */
@Module({
  imports: [NotificationsCoreModule],
  providers: [NotificationsHandler],
  exports: [NotificationsHandler],
})
export class NotificationsWorkerModule {}
