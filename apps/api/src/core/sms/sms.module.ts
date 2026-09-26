import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { ConsoleSmsProvider } from './console.provider.js';
import { EskizSmsProvider } from './eskiz.provider.js';
import { PlaymobileSmsProvider } from './playmobile.provider.js';
import { SMS_PROVIDER, type SmsProvider } from './sms.provider.js';

// Env validation guarantees the selected provider's credentials are present.
function createSmsProvider(env: Env): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case 'eskiz':
      return new EskizSmsProvider({
        baseUrl: env.ESKIZ_BASE_URL,
        email: env.ESKIZ_EMAIL!,
        password: env.ESKIZ_PASSWORD!,
        from: env.ESKIZ_FROM,
      });
    case 'playmobile':
      return new PlaymobileSmsProvider({
        baseUrl: env.PLAYMOBILE_BASE_URL!,
        username: env.PLAYMOBILE_USERNAME!,
        password: env.PLAYMOBILE_PASSWORD!,
        originator: env.PLAYMOBILE_ORIGINATOR,
      });
    case 'console':
      return new ConsoleSmsProvider();
  }
}

@Global()
@Module({
  providers: [{ provide: SMS_PROVIDER, inject: [ENV], useFactory: createSmsProvider }],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
