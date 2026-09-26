import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { Database } from '../../core/db/database.js';
import type { PushApp } from '../../core/db/schema.js';
import { SMS_PROVIDER, SmsDeliveryError, type SmsProvider } from '../../core/sms/sms.provider.js';
import type { Locale, PushText } from './messages.js';
import { PUSH_PROVIDER, type PushProvider, PushUnavailableError } from './push.provider.js';

export interface PushDelivery {
  /** Idempotency scope, e.g. "event:<outbox id>"; recipient and channel are appended. */
  key: string;
  kind: string;
  rideId: string | null;
  userId: string;
  app: PushApp;
  text: (locale: Locale) => PushText;
  data?: Record<string, unknown>;
  /** Offers are urgent and useless after their timeout. */
  urgent?: { ttlSeconds: number };
}

export interface SmsDelivery {
  key: string;
  kind: string;
  rideId: string | null;
  userId: string | null;
  phone: string;
  text: string;
}

type Outcome = 'sent' | 'failed' | 'skipped' | 'duplicate';

/**
 * Sends push and SMS, logging each (event, recipient, channel) in `notifications` so an
 * outbox retry does not send twice. A provider outage throws (the event is retried); a
 * refusal for one recipient is recorded as failed and not retried.
 */
@Injectable()
export class Notifier {
  private readonly logger = new Logger(Notifier.name);

  constructor(
    private readonly db: Database,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: PushProvider,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  async push(d: PushDelivery): Promise<Outcome> {
    const dedupeKey = `${d.key}:${d.userId}:push`;
    if (await this.seen(dedupeKey)) return 'duplicate';
    const devices = await this.db.kysely
      .selectFrom('push_devices')
      .select(['token', 'locale'])
      .where('user_id', '=', d.userId)
      .where('app', '=', d.app)
      .orderBy('last_seen_at', 'desc')
      .limit(5)
      .execute();
    if (!devices.length) {
      await this.record(dedupeKey, d, 'push', 'skipped', 'no device');
      return 'skipped';
    }
    const messages = devices.map((dev) => ({
      to: dev.token,
      ...d.text(dev.locale),
      data: { kind: d.kind, ...(d.rideId ? { rideId: d.rideId } : {}), ...d.data },
      sound: 'default' as const,
      priority: 'high' as const,
      channelId: d.urgent ? 'offers' : 'rides',
      ...(d.urgent ? { ttl: d.urgent.ttlSeconds } : {}),
    }));
    let tickets;
    try {
      tickets = await this.pushProvider.send(messages);
    } catch (error) {
      if (error instanceof PushUnavailableError) throw error;
      await this.record(dedupeKey, d, 'push', 'failed', (error as Error).message);
      return 'failed';
    }
    // a token the service calls unregistered belongs to an uninstalled app
    const dead = tickets
      .map((t, i) =>
        t.status === 'error' && t.error === 'DeviceNotRegistered' ? devices[i]!.token : null,
      )
      .filter((t): t is string => t !== null);
    if (dead.length)
      await this.db.kysely.deleteFrom('push_devices').where('token', 'in', dead).execute();
    const ok = tickets.some((t) => t.status === 'ok');
    const errors = tickets.filter((t) => t.status === 'error').map((t) => t.error ?? t.message);
    await this.record(dedupeKey, d, 'push', ok ? 'sent' : 'failed', errors.join('; ') || null);
    return ok ? 'sent' : 'failed';
  }

  async sms(d: SmsDelivery): Promise<Outcome> {
    const dedupeKey = `${d.key}:${d.userId ?? d.phone}:sms`;
    if (await this.seen(dedupeKey)) return 'duplicate';
    try {
      const receipt = await this.smsProvider.send({ to: d.phone, text: d.text });
      await this.record(dedupeKey, d, 'sms', 'sent', null, receipt.providerMessageId);
      return 'sent';
    } catch (error) {
      const status = error instanceof SmsDeliveryError ? error.httpStatus : undefined;
      // unreachable or 5xx: try again later; any other refusal is final for this message
      if (status === undefined || status >= 500) throw error;
      this.logger.warn(`SMS to ${d.phone} refused: ${(error as Error).message}`);
      await this.record(dedupeKey, d, 'sms', 'failed', (error as Error).message);
      return 'failed';
    }
  }

  private async seen(dedupeKey: string): Promise<boolean> {
    const row = await this.db.kysely
      .selectFrom('notifications')
      .select('id')
      .where('dedupe_key', '=', dedupeKey)
      .executeTakeFirst();
    return Boolean(row);
  }

  private async record(
    dedupeKey: string,
    d: { kind: string; rideId: string | null; userId: string | null },
    channel: 'push' | 'sms',
    status: 'sent' | 'failed' | 'skipped',
    error: string | null,
    providerRef: string | null = null,
  ): Promise<void> {
    await this.db.kysely
      .insertInto('notifications')
      .values({
        id: uuidv7(),
        dedupe_key: dedupeKey,
        user_id: d.userId,
        channel,
        kind: d.kind,
        ride_id: d.rideId,
        status,
        error: error?.slice(0, 500) ?? null,
        provider_ref: providerRef,
      })
      .onConflict((oc) => oc.column('dedupe_key').doNothing())
      .execute();
  }
}
