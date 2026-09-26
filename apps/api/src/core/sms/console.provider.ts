import { Logger } from '@nestjs/common';
import type { SmsMessage, SmsProvider, SmsReceipt } from './sms.provider.js';

/**
 * Development and test transport: writes the message to the log instead of
 * sending it, and keeps recent messages in memory so tests can read OTP codes.
 * Rejected by env validation when NODE_ENV=production.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  readonly sent: SmsMessage[] = [];
  private readonly logger = new Logger('ConsoleSms');

  async send(message: SmsMessage): Promise<SmsReceipt> {
    this.sent.push(message);
    if (this.sent.length > 200) this.sent.shift();
    this.logger.warn(`SMS not sent (console provider) to ${message.to}: ${message.text}`);
    return { provider: this.name, providerMessageId: null };
  }

  lastTo(phone: string): SmsMessage | undefined {
    return this.sent.findLast((m) => m.to === phone);
  }
}
