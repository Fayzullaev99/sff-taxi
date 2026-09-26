import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth-context.js';
import { Database } from '../db/database.js';
import { ZodPipe } from '../http/zod.pipe.js';
import { MAX_ATTEMPTS } from './dispatcher.js';

const OutboxQuery = z.object({
  state: z.enum(['dead', 'failing']).default('dead'),
  cursor: z.uuid().optional(),
});

@Injectable()
export class OutboxAdminService {
  constructor(private readonly db: Database) {}

  /**
   * Events the worker gave up on (dead) or is still retrying (failing): a push, an SMS, a
   * dispatch step or a fiscal receipt that did not happen, and why.
   */
  async events(filter: z.output<typeof OutboxQuery>) {
    const rows = await this.db.kysely
      .selectFrom('outbox')
      .select([
        'id',
        'topic',
        'payload',
        'attempts',
        'last_error as lastError',
        'next_attempt_at as nextAttemptAt',
        'created_at as createdAt',
      ])
      .where('processed_at', 'is', null)
      .$if(filter.state === 'dead', (q) => q.where('attempts', '>=', MAX_ATTEMPTS))
      .$if(filter.state === 'failing', (q) =>
        q.where('attempts', '<', MAX_ATTEMPTS).where('last_error', 'is not', null),
      )
      .$if(Boolean(filter.cursor), (q) => q.where('id', '<', filter.cursor!))
      .orderBy('id', 'desc')
      .limit(100)
      .execute();
    return rows.map((r) => ({ ...r, maxAttempts: MAX_ATTEMPTS }));
  }

  /** An operator fixed the cause (a key replaced, a provider back up): try the event again. */
  async retry(id: string) {
    const row = await this.db.kysely
      .updateTable('outbox')
      .set({ attempts: 0, next_attempt_at: new Date() })
      .where('id', '=', id)
      .where('processed_at', 'is', null)
      .returning(['id', 'topic', 'attempts', 'last_error as lastError'])
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Hodisa topilmadi yoki allaqachon bajarilgan');
    return row;
  }
}

@Controller('admin/outbox')
@AdminOnly()
export class OutboxAdminController {
  constructor(private readonly outbox: OutboxAdminService) {}

  /** Side effects that did not happen: dead (given up) or failing (still retrying). */
  @Get()
  list(@Query(new ZodPipe(OutboxQuery)) q: z.output<typeof OutboxQuery>) {
    return this.outbox.events(q);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.outbox.retry(id);
  }
}

@Module({ controllers: [OutboxAdminController], providers: [OutboxAdminService] })
export class OutboxAdminModule {}
