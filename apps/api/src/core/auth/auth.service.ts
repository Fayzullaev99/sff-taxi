import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { ENV, type Env } from '../../config/env.js';
import { Database } from '../db/database.js';
import type { SessionClient } from '../db/schema.js';
import { RateLimiter } from '../redis/rate-limiter.js';
import { SMS_PROVIDER, type SmsProvider } from '../sms/sms.provider.js';
import type { RequestMeta } from './auth-context.js';
import { parseRefreshToken, secretMatches, TokenService, type TokenPair } from './tokens.js';

export const RESEND_AFTER_SECONDS = 60;
/**
 * Wrong codes per phone per hour, across new codes. Without it the store-review phones
 * (fixed code, no SMS, no resend limit) could be brute-forced: every new code brought
 * OTP_MAX_ATTEMPTS fresh guesses.
 */
export const WRONG_CODES_PER_HOUR = 10;

/**
 * Passwordless sign-in: a one-time SMS code proves the phone, and the first
 * successful sign-in creates the account. The same account can be a rider,
 * a driver and an operator; each app asks for its own session.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly hmacKey: string;
  private readonly fixedCodes: Map<string, string>;

  constructor(
    private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly limiter: RateLimiter,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.hmacKey = `${env.JWT_ACCESS_SECRET}:otp`;
    this.fixedCodes = new Map(
      env.OTP_FIXED_CODES.map((pair) => pair.split(':') as [string, string]),
    );
  }

  async requestCode(phone: string, meta: RequestMeta) {
    const fixed = this.fixedCodes.get(phone);
    // a fixed code sends no SMS, so there is nothing to throttle
    if (!fixed) await this.throttle(phone, meta);
    const response = {
      expiresInSeconds: this.env.OTP_TTL_SECONDS,
      resendAfterSeconds: RESEND_AFTER_SECONDS,
    };
    const code = fixed ?? String(randomInt(1_000_000)).padStart(6, '0');
    const id = uuidv7();
    await this.db.kysely
      .insertInto('phone_verifications')
      .values({
        id,
        phone,
        code_hash: this.hash(code),
        expires_at: new Date(Date.now() + this.env.OTP_TTL_SECONDS * 1000),
        ip: meta.ip,
      })
      .execute();
    if (fixed) return response;

    try {
      const receipt = await this.sms.send({
        to: phone,
        text: this.env.SMS_OTP_TEMPLATE.replace('{code}', code),
      });
      await this.db.kysely
        .updateTable('phone_verifications')
        .set({ provider: receipt.provider, provider_message_id: receipt.providerMessageId })
        .where('id', '=', id)
        .execute();
    } catch (error) {
      this.logger.error(`OTP SMS failed for verification ${id}: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'SMS yuborib bo‘lmadi, birozdan so‘ng qayta urinib ko‘ring',
      );
    }
    return response;
  }

  async verifyCode(
    phone: string,
    code: string,
    client: SessionClient,
    meta: RequestMeta,
  ): Promise<TokenPair & { isNewUser: boolean }> {
    const wrongCodes = {
      name: 'otp:wrong',
      subject: phone,
      max: WRONG_CODES_PER_HOUR,
      windowSeconds: 3600,
      message: 'Juda ko‘p noto‘g‘ri kod kiritildi, keyinroq urinib ko‘ring',
    };
    await this.limiter.assertNotBlocked(wrongCodes);
    const outcome = await this.db.transaction(async (trx) => {
      const row = await trx
        .selectFrom('phone_verifications')
        .select(['id', 'code_hash', 'attempts', 'expires_at'])
        .where('phone', '=', phone)
        .where('verified_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(1)
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.expires_at <= new Date()) return { ok: false, reason: 'invalid' } as const;
      if (row.attempts >= this.env.OTP_MAX_ATTEMPTS) {
        return { ok: false, reason: 'exhausted' } as const;
      }
      const matches = timingSafeEqual(row.code_hash, this.hash(code));
      await trx
        .updateTable('phone_verifications')
        .set((eb) => ({
          attempts: eb('attempts', '+', 1),
          ...(matches ? { verified_at: new Date() } : {}),
        }))
        .where('id', '=', row.id)
        .execute();
      // returned rather than thrown so the attempt counter commits
      return matches ? ({ ok: true } as const) : ({ ok: false, reason: 'invalid' } as const);
    });
    if (!outcome.ok) {
      await this.limiter.recordFailure(wrongCodes);
      throw new BadRequestException(
        outcome.reason === 'exhausted'
          ? 'Juda ko‘p noto‘g‘ri urinish, yangi kod so‘rang'
          : 'Kod noto‘g‘ri yoki muddati o‘tgan',
      );
    }

    return this.db.transaction(async (trx) => {
      const inserted = await trx
        .insertInto('users')
        .values({ id: uuidv7(), phone })
        .onConflict((oc) => oc.column('phone').doNothing())
        .returning('id')
        .executeTakeFirst();
      const user = await trx
        .selectFrom('users')
        .select(['id', 'status'])
        .where('phone', '=', phone)
        .executeTakeFirstOrThrow();
      if (user.status !== 'active') throw new UnauthorizedException('Hisob bloklangan');
      if (this.env.ADMIN_PHONES.includes(phone)) {
        await trx
          .insertInto('admins')
          .values({ user_id: user.id })
          .onConflict((oc) => oc.column('user_id').doNothing())
          .execute();
      }
      if (client === 'admin') {
        // the operator panel is for platform operators only: say so instead of an empty panel
        const admin = await trx
          .selectFrom('admins')
          .select('user_id')
          .where('user_id', '=', user.id)
          .executeTakeFirst();
        if (!admin) throw new ForbiddenException('Siz platforma operatori emassiz');
      }
      const pair = await this.tokens.issuePair(trx, user.id, client, meta);
      return { ...pair, isNewUser: Boolean(inserted) };
    });
  }

  /**
   * Exchanges a refresh token for a new pair. A token that was already rotated
   * being presented again means it leaked: the whole family is revoked.
   */
  async refresh(token: string, meta: RequestMeta): Promise<TokenPair> {
    const parsed = parseRefreshToken(token);
    if (!parsed) throw new UnauthorizedException();
    const result = await this.db.transaction(async (trx) => {
      const session = await trx
        .selectFrom('sessions as s')
        .innerJoin('users as u', 'u.id', 's.user_id')
        .select([
          's.id',
          's.user_id',
          's.family_id',
          's.token_hash',
          's.client',
          's.expires_at',
          's.rotated_at',
          's.revoked_at',
          'u.status',
        ])
        .where('s.id', '=', parsed.id)
        .forUpdate('s')
        .executeTakeFirst();
      if (!session || !secretMatches(session.token_hash, parsed.secretHash)) return null;
      if (session.rotated_at) {
        await trx
          .updateTable('sessions')
          .set({ revoked_at: new Date() })
          .where('family_id', '=', session.family_id)
          .where('revoked_at', 'is', null)
          .execute();
        return 'reused' as const;
      }
      if (session.revoked_at || session.expires_at <= new Date() || session.status !== 'active') {
        return null;
      }
      await trx
        .updateTable('sessions')
        .set({ rotated_at: new Date() })
        .where('id', '=', session.id)
        .execute();
      return this.tokens.issuePair(trx, session.user_id, session.client, meta, session.family_id);
    });
    if (!result || result === 'reused') throw new UnauthorizedException();
    return result;
  }

  async logout(token: string): Promise<void> {
    const parsed = parseRefreshToken(token);
    if (!parsed) return;
    const session = await this.db.kysely
      .selectFrom('sessions')
      .select(['family_id', 'token_hash'])
      .where('id', '=', parsed.id)
      .executeTakeFirst();
    if (!session || !secretMatches(session.token_hash, parsed.secretHash)) return;
    await this.db.kysely
      .updateTable('sessions')
      .set({ revoked_at: new Date() })
      .where('family_id', '=', session.family_id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /** SMS cost money and annoy people: one per minute, six an hour per phone. */
  private throttle(phone: string, meta: RequestMeta): Promise<void> {
    return this.limiter.consume(
      {
        name: 'otp:resend',
        subject: phone,
        max: 1,
        windowSeconds: RESEND_AFTER_SECONDS,
        message: 'Yangi kodni bir daqiqadan so‘ng so‘rang',
      },
      { name: 'otp:phone', subject: phone, max: 6, windowSeconds: 3600 },
      { name: 'otp:ip', subject: meta.ip ?? 'unknown', max: 30, windowSeconds: 3600, perIp: true },
    );
  }

  private hash(code: string): Buffer {
    return createHmac('sha256', this.hmacKey).update(code).digest();
  }
}
