import {
  bodySnippet,
  providerFetch,
  SmsDeliveryError,
  type SmsMessage,
  type SmsProvider,
  type SmsReceipt,
} from './sms.provider.js';

export interface EskizConfig {
  baseUrl: string;
  email: string;
  password: string;
  from: string;
}

/**
 * Eskiz.uz (notify.eskiz.uz). Authenticates with email/password for a bearer
 * token (valid ~30 days), caches it, and logs in again when a send returns 401.
 * Note: Eskiz only delivers texts matching a template approved in its cabinet.
 */
export class EskizSmsProvider implements SmsProvider {
  readonly name = 'eskiz';
  private token: Promise<string> | null = null;

  constructor(private readonly config: EskizConfig) {}

  async send(message: SmsMessage): Promise<SmsReceipt> {
    let res = await this.sendOnce(message, await this.getToken());
    if (res.status === 401) {
      this.token = null;
      res = await this.sendOnce(message, await this.getToken());
    }
    if (!res.ok) {
      throw new SmsDeliveryError(this.name, `send failed: ${await bodySnippet(res)}`, res.status);
    }
    const body = (await res.json()) as { id?: unknown; status?: unknown };
    return { provider: this.name, providerMessageId: typeof body.id === 'string' ? body.id : null };
  }

  private sendOnce(message: SmsMessage, token: string): Promise<Response> {
    const form = new FormData();
    form.set('mobile_phone', message.to.replace(/^\+/, ''));
    form.set('message', message.text);
    form.set('from', this.config.from);
    return providerFetch(this.name, `${this.config.baseUrl}/api/message/sms/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  }

  private getToken(): Promise<string> {
    // share one in-flight login between concurrent sends; forget it if it fails
    this.token ??= this.login().catch((error: unknown) => {
      this.token = null;
      throw error;
    });
    return this.token;
  }

  private async login(): Promise<string> {
    const form = new FormData();
    form.set('email', this.config.email);
    form.set('password', this.config.password);
    const res = await providerFetch(this.name, `${this.config.baseUrl}/api/auth/login`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      throw new SmsDeliveryError(this.name, `login failed: ${await bodySnippet(res)}`, res.status);
    }
    const body = (await res.json()) as { data?: { token?: unknown } };
    if (typeof body.data?.token !== 'string') {
      throw new SmsDeliveryError(this.name, 'login response has no token');
    }
    return body.data.token;
  }
}
