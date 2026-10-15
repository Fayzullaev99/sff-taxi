import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuthUser } from '../../core/auth/auth-context.js';
import { Database } from '../../core/db/database.js';
import type { RideMessagesTable } from '../../core/db/schema.js';
import { emit } from '../../core/outbox/outbox.js';
import {
  CHAT_MAX_LENGTH,
  chatClosesAt,
  type ChatRole,
  chatWritable,
  cleanChatText,
  QUICK_REPLIES,
  quickReplyText,
} from '../../lib/chat.js';

type Message = Selectable<RideMessagesTable>;

/** A ride's messages are capped: a chat is for the pickup, not a conversation. */
export const CHAT_MAX_MESSAGES = 300;

export interface SendInput {
  text: string | null;
  quickReply: string | null;
  clientMessageId: string | null;
}

/**
 * The ride chat: the rider and the ride's driver write from the assignment until a short
 * while after completion (src/lib/chat.ts), then read-only. Every message is stored (operators
 * read a ride's chat for complaints and safety), delivered over the stream and pushed to the
 * other side through the outbox (`ride.message`). A driver reads only the messages written
 * while they were the ride's driver.
 */
@Injectable()
export class ChatService {
  constructor(private readonly db: Database) {}

  /** The conversation for the rider or the driver, with what is unread and whether it is open. */
  async conversation(user: AuthUser, rideId: string, role: ChatRole, after?: string) {
    const ride = await this.rideFor(user, rideId, role);
    const now = new Date();
    const driverId = role === 'driver' ? user.userId : null;
    const rows = await this.db.kysely
      .selectFrom('ride_messages')
      .selectAll()
      .where('ride_id', '=', ride.id)
      .$if(driverId !== null, (q) => q.where('driver_id', '=', driverId!))
      .$if(Boolean(after), (q) => q.where('id', '>', after!))
      .orderBy('id')
      .limit(CHAT_MAX_MESSAGES)
      .execute();
    const unread = await this.unread(ride.id, role, driverId);
    const other = role === 'rider' ? 'driver' : 'rider';
    return {
      rideId: ride.id,
      writable: chatWritable({ status: ride.status, completedAt: ride.completed_at }, now),
      closesAt: chatClosesAt({ status: ride.status, completedAt: ride.completed_at }),
      unread,
      maxLength: CHAT_MAX_LENGTH,
      quickReplies: Object.entries(QUICK_REPLIES[role]).map(([key, text]) => ({ key, text })),
      /** Who is on the other side (the name as the ride shows it). */
      counterpart:
        other === 'driver'
          ? { role: other, name: ride.driver_name }
          : { role: other, name: ride.rider_name },
      messages: rows.map((m) => this.view(m, role)),
    };
  }

  /** Unread messages from the other side (the badge on the ride screen). */
  async unread(rideId: string, role: ChatRole, driverId: string | null): Promise<number> {
    const row = await this.db.kysely
      .selectFrom('ride_messages')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('ride_id', '=', rideId)
      .where('author_role', '=', role === 'rider' ? 'driver' : 'rider')
      .where('read_at', 'is', null)
      .$if(driverId !== null, (q) => q.where('driver_id', '=', driverId!))
      .executeTakeFirstOrThrow();
    return row.n;
  }

  /** Writes a message (text or a quick reply). A retry with the same clientMessageId is one message. */
  async send(user: AuthUser, rideId: string, role: ChatRole, input: SendInput) {
    const text = input.quickReply
      ? quickReplyText(role, input.quickReply)
      : cleanChatText(input.text ?? '');
    if (input.quickReply && !text) throw new BadRequestException('Bunday tezkor javob yo‘q');
    if (!text) throw new BadRequestException('Xabar bo‘sh');
    if (text.length > CHAT_MAX_LENGTH) {
      throw new BadRequestException(`Xabar ${CHAT_MAX_LENGTH} belgidan oshmasin`);
    }
    if (input.clientMessageId) {
      const repeat = await this.db.kysely
        .selectFrom('ride_messages')
        .selectAll()
        .where('author_id', '=', user.userId)
        .where('client_message_id', '=', input.clientMessageId)
        .executeTakeFirst();
      if (repeat) return this.view(repeat, role);
    }
    const message = await this.db.transaction(async (trx) => {
      // the ride row's lock orders this message after any state change in flight (a ride
      // completing or being given to another driver), so the checks below hold when it lands
      const ride = await trx
        .selectFrom('rides')
        .select(['id', 'rider_id', 'driver_id', 'status', 'completed_at'])
        .where('id', '=', rideId)
        .forShare()
        .executeTakeFirst();
      if (!ride || !this.isParty(ride, user.userId, role)) {
        throw new NotFoundException('Buyurtma topilmadi');
      }
      if (!chatWritable({ status: ride.status, completedAt: ride.completed_at }, new Date())) {
        throw new ForbiddenException('Suhbat yopiq: safar tugagan yoki haydovchi hali yo‘q');
      }
      const count = await trx
        .selectFrom('ride_messages')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('ride_id', '=', ride.id)
        .executeTakeFirstOrThrow();
      if (count.n >= CHAT_MAX_MESSAGES) {
        throw new ConflictException('Bu safar uchun xabarlar chegarasiga yetildi');
      }
      const inserted = await trx
        .insertInto('ride_messages')
        .values({
          id: uuidv7(),
          ride_id: ride.id,
          driver_id: ride.driver_id!,
          author_id: user.userId,
          author_role: role,
          text,
          quick_reply: input.quickReply,
          client_message_id: input.clientMessageId,
        })
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst();
      if (!inserted) return null;
      await emit(trx, 'ride.message', {
        messageId: inserted.id,
        rideId: ride.id,
        authorRole: role,
        recipientId: role === 'rider' ? ride.driver_id : ride.rider_id,
      });
      return inserted;
    });
    if (message) return this.view(message, role);
    // the same clientMessageId raced in from a second tap: that message
    const again = await this.db.kysely
      .selectFrom('ride_messages')
      .selectAll()
      .where('author_id', '=', user.userId)
      .where('client_message_id', '=', input.clientMessageId)
      .executeTakeFirstOrThrow();
    return this.view(again, role);
  }

  /** The reader saw the other side's messages: read receipts and the badge go to zero. */
  async markRead(user: AuthUser, rideId: string, role: ChatRole) {
    const ride = await this.rideFor(user, rideId, role);
    const now = new Date();
    const updated = await this.db.transaction(async (trx) => {
      const rows = await trx
        .updateTable('ride_messages')
        .set({ read_at: now })
        .where('ride_id', '=', ride.id)
        .where('author_role', '=', role === 'rider' ? 'driver' : 'rider')
        .where('read_at', 'is', null)
        .$if(role === 'driver', (q) => q.where('driver_id', '=', user.userId))
        .returning('id')
        .execute();
      if (rows.length) {
        await emit(trx, 'ride.messages_read', {
          rideId: ride.id,
          readerRole: role,
          // the author of what was read hears it (the driver of those messages for the rider)
          authorId: role === 'rider' ? ride.driver_id : ride.rider_id,
          count: rows.length,
        });
      }
      return rows.length;
    });
    return { read: updated, readAt: updated ? now : null };
  }

  /** Operators: a ride's whole chat (complaints, safety), every driver's part included. */
  async forOperator(rideId: string) {
    const ride = await this.db.kysely
      .selectFrom('rides')
      .select(['id', 'status', 'completed_at'])
      .where('id', '=', rideId)
      .executeTakeFirst();
    if (!ride) throw new NotFoundException('Buyurtma topilmadi');
    const rows = await this.db.kysely
      .selectFrom('ride_messages as m')
      .innerJoin('users as u', 'u.id', 'm.author_id')
      .select([
        'm.id',
        'm.author_role as authorRole',
        'm.author_id as authorId',
        'u.full_name as authorName',
        'u.phone as authorPhone',
        'm.driver_id as driverId',
        'm.text',
        'm.quick_reply as quickReply',
        'm.read_at as readAt',
        'm.created_at as createdAt',
      ])
      .where('m.ride_id', '=', rideId)
      .orderBy('m.id')
      .execute();
    return {
      rideId,
      writable: chatWritable({ status: ride.status, completedAt: ride.completed_at }, new Date()),
      messages: rows,
    };
  }

  /** A message as its reader sees it: `mine` from the reader's side. */
  private view(m: Message, role: ChatRole) {
    return {
      id: m.id,
      rideId: m.ride_id,
      authorRole: m.author_role,
      mine: m.author_role === role,
      text: m.text,
      quickReply: m.quick_reply,
      readAt: m.read_at,
      createdAt: m.created_at,
    };
  }

  private isParty(
    ride: { rider_id: string; driver_id: string | null },
    userId: string,
    role: ChatRole,
  ): boolean {
    return role === 'rider' ? ride.rider_id === userId : ride.driver_id === userId;
  }

  /** The ride if the caller is its rider (or its current driver); 404 otherwise. */
  private async rideFor(user: AuthUser, rideId: string, role: ChatRole) {
    const ride = await this.db.kysely
      .selectFrom('rides as r')
      .leftJoin('drivers as d', 'd.user_id', 'r.driver_id')
      .select([
        'r.id',
        'r.rider_id',
        'r.driver_id',
        'r.status',
        'r.completed_at',
        'r.rider_name',
        'd.full_name as driver_name',
      ])
      .where('r.id', '=', rideId)
      .executeTakeFirst();
    if (!ride || !this.isParty(ride, user.userId, role)) {
      throw new NotFoundException('Buyurtma topilmadi');
    }
    return ride;
  }
}
