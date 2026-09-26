import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { ENV, type Env } from '../../config/env.js';
import { type AuthUser, CurrentUser, Public } from '../../core/auth/auth-context.js';
import { Database } from '../../core/db/database.js';
import { TooManyRequestsException } from '../../core/redis/rate-limiter.js';
import { REDIS } from '../../core/redis/redis.token.js';
import { REALTIME_CHANNEL, type RealtimeMessage } from './realtime.publisher.js';

const TICKET_TTL_SECONDS = 60;
const HEARTBEAT_MS = 25_000;
/** A data event (not an SSE comment) so clients can tell a live stream from a dead one. */
const PING = `data: ${JSON.stringify({ type: 'ping' })}\n\n`;
/** Open streams per account: a few devices and tabs, not a flood. */
const MAX_STREAMS_PER_USER = 10;

interface Client {
  userId: string;
  isAdmin: boolean;
  res: Response;
}

/**
 * API-side: one Redis subscription per instance fans messages out to this
 * instance's open server-sent-event streams.
 */
@Injectable()
export class RealtimeHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeHub.name);
  private readonly clients = new Set<Client>();
  private subscriber: Redis | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.subscriber.on('message', (_channel, raw) => this.dispatch(raw));
    await this.subscriber.subscribe(REALTIME_CHANNEL);
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.res.write(PING);
    }, HEARTBEAT_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
    await this.subscriber?.quit();
  }

  count(userId: string): number {
    let n = 0;
    for (const c of this.clients) if (c.userId === userId) n++;
    return n;
  }

  add(client: Client): void {
    this.clients.add(client);
    client.res.on('close', () => this.clients.delete(client));
  }

  private dispatch(raw: string): void {
    let message: RealtimeMessage;
    try {
      message = JSON.parse(raw) as RealtimeMessage;
    } catch {
      this.logger.warn('Dropped a malformed realtime message');
      return;
    }
    const data = `data: ${JSON.stringify(message.event)}\n\n`;
    const { to } = message;
    for (const c of this.clients) {
      const match = (to.userIds?.includes(c.userId) ?? false) || (to.admins === true && c.isAdmin);
      if (match) c.res.write(data);
    }
  }
}

@Controller('stream')
export class StreamController {
  constructor(
    private readonly hub: RealtimeHub,
    private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * A single-use ticket for opening the stream. Browsers' EventSource cannot
   * send an Authorization header, and access tokens must not end up in URLs
   * (proxy and access logs), so the stream URL carries this instead.
   */
  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  async ticket(@CurrentUser() user: AuthUser) {
    const ticket = randomBytes(24).toString('base64url');
    await this.redis.set(`rt:ticket:${ticket}`, user.userId, 'EX', TICKET_TTL_SECONDS);
    return { ticket, expiresInSeconds: TICKET_TTL_SECONDS };
  }

  @Public()
  @Get()
  async open(@Query('ticket') ticket: string | undefined, @Res() res: Response): Promise<void> {
    const userId =
      ticket && /^[\w-]{32}$/.test(ticket) ? await this.redis.getdel(`rt:ticket:${ticket}`) : null;
    if (!userId) throw new UnauthorizedException('Chipta noto‘g‘ri yoki eskirgan');
    if (this.hub.count(userId) >= MAX_STREAMS_PER_USER) throw new TooManyRequestsException(30);

    const user = await this.db.kysely
      .selectFrom('users as u')
      .leftJoin('admins as a', 'a.user_id', 'u.id')
      .select(['u.status', 'a.user_id as adminId'])
      .where('u.id', '=', userId)
      .executeTakeFirst();
    if (!user || user.status !== 'active') throw new UnauthorizedException();

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx would otherwise buffer the stream
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: 3000\n\ndata: ${JSON.stringify({ type: 'ready' })}\n\n`);
    this.hub.add({
      userId,
      isAdmin: user.adminId !== null,
      res,
    });
  }
}

/**
 * Server-sent events for the rider app (ride status, the driver's position), the driver app
 * (offers, ride changes, account status) and the operator panel (every ride, alerts, SOS).
 */
@Module({
  controllers: [StreamController],
  providers: [RealtimeHub],
})
export class RealtimeModule {}
