import { randomBytes } from 'node:crypto';
import {
  bodySnippet,
  providerFetch,
  SmsDeliveryError,
  type SmsMessage,
  type SmsProvider,
  type SmsReceipt,
} from './sms.provider.js';

export interface PlaymobileConfig {
  /** Contract-specific broker URL, e.g. https://send.smsxabar.uz/broker-api */
  baseUrl: string;
  username: string;
  password: string;
  originator: string;
}

/**
 * Play Mobile SMS-Broker API (smsxabar.uz): POST {baseUrl}/send, Basic auth,
 * JSON body. A 200 means "Request is received"; delivery statuses arrive later
 * on a partner callback URL, keyed by our message-id.
 */
export class PlaymobileSmsProvider implements SmsProvider {
  readonly name = 'playmobile';
  private readonly authHeader: string;

  constructor(private readonly config: PlaymobileConfig) {
    this.authHeader = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  }

  async send(message: SmsMessage): Promise<SmsReceipt> {
    const messageId = newMessageId();
    const res = await providerFetch(this.name, `${this.config.baseUrl}/send`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        messages: [
          {
            // strictly 998XXXXXXXXX: no "+" and no spaces
            recipient: message.to.replace(/^\+/, ''),
            'message-id': messageId,
            sms: { originator: this.config.originator, content: { text: message.text } },
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new SmsDeliveryError(this.name, `send failed: ${await bodySnippet(res)}`, res.status);
    }
    return { provider: this.name, providerMessageId: messageId };
  }
}

/** Unique per message and at most 20 characters, as the broker requires. */
export function newMessageId(): string {
  return `taxi${Date.now().toString(36)}${randomBytes(4).toString('hex')}`.slice(0, 20);
}
