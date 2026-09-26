import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { ENV, type Env } from '../../config/env.js';
import type { Tx } from '../db/database.js';
import type { SessionClient } from '../db/schema.js';
import type { RequestMeta } from './auth-context.js';

const ACCESS_AUDIENCE = 'access';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

/**
 * Refresh tokens are "<sessionId>.<secret>"; only a SHA-256 of the secret is
 * stored, so a database leak does not leak usable tokens.
 */
export function parseRefreshToken(token: string): { id: string; secretHash: Buffer } | null {
  const [id, secret, ...rest] = token.split('.');
  if (rest.length || !id || !secret || !UUID.test(id) || !/^[\w-]{43}$/.test(secret)) return null;
  return { id, secretHash: sha256(secret) };
}

export function secretMatches(stored: Buffer, presented: Buffer): boolean {
  return stored.length === presented.length && timingSafeEqual(stored, presented);
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Access token + a new refresh session in the given family. */
  async issuePair(
    trx: Tx,
    userId: string,
    client: SessionClient,
    meta: RequestMeta,
    familyId: string = uuidv7(),
  ): Promise<TokenPair> {
    const id = uuidv7();
    const secret = randomBytes(32).toString('base64url');
    await trx
      .insertInto('sessions')
      .values({
        id,
        user_id: userId,
        family_id: familyId,
        token_hash: sha256(secret),
        client,
        expires_at: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        user_agent: meta.userAgent,
        ip: meta.ip,
      })
      .execute();
    const accessToken = await this.jwt.signAsync(
      {},
      { subject: userId, audience: ACCESS_AUDIENCE, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS },
    );
    return {
      accessToken,
      accessTokenExpiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      refreshToken: `${id}.${secret}`,
    };
  }

  /** The user id of a valid access token, or null. */
  async verifyAccess(token: string): Promise<string | null> {
    try {
      const { sub } = await this.jwt.verifyAsync<{ sub?: unknown }>(token, {
        audience: ACCESS_AUDIENCE,
      });
      return typeof sub === 'string' && UUID.test(sub) ? sub : null;
    } catch {
      return null;
    }
  }
}
