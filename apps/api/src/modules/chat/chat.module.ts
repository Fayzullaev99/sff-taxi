import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { ChatService } from './chat.service.js';

const SendBody = z
  .object({
    /** Free text (cleaned of control characters; up to 500 characters). */
    text: z.string().max(2000).nullable().default(null),
    /** Or a quick reply's key (GET …/messages lists them). */
    quickReply: z
      .string()
      .regex(/^[a-z_]{2,40}$/)
      .nullable()
      .default(null),
    /** The app's id for this message: a retry after a lost answer is one message. */
    clientMessageId: z.uuid().nullable().default(null),
  })
  .refine((b) => Boolean(b.text?.trim()) !== Boolean(b.quickReply), {
    message: 'Matn yoki tezkor javobdan bittasini yuboring',
    path: ['text'],
  });
const AfterQuery = z.object({ after: z.uuid().optional() });

/** 20 messages a minute per person: plenty for "I'm coming out", not for flooding. */
const SEND_LIMIT = { name: 'chat:send', by: 'user' as const, max: 20, windowSeconds: 60 };

@Controller('rides/:id/messages')
export class RiderChatController {
  constructor(private readonly chat: ChatService) {}

  /** The conversation (`?after` = the last id seen), unread count, quick replies. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(AfterQuery)) q: z.output<typeof AfterQuery>,
  ) {
    return this.chat.conversation(user, id, 'rider', q.after);
  }

  @Post()
  @RateLimit(SEND_LIMIT)
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SendBody)) body: z.output<typeof SendBody>,
  ) {
    return this.chat.send(user, id, 'rider', body);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.markRead(user, id, 'rider');
  }
}

@Controller('driver/rides/:id/messages')
export class DriverChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(AfterQuery)) q: z.output<typeof AfterQuery>,
  ) {
    return this.chat.conversation(user, id, 'driver', q.after);
  }

  @Post()
  @RateLimit(SEND_LIMIT)
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SendBody)) body: z.output<typeof SendBody>,
  ) {
    return this.chat.send(user, id, 'driver', body);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.markRead(user, id, 'driver');
  }
}

/** Operators read a ride's chat (complaints, safety); they do not write in it. */
@Controller('admin/rides/:id/messages')
@AdminOnly()
export class AdminChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.chat.forOperator(id);
  }
}

@Module({
  controllers: [RiderChatController, DriverChatController, AdminChatController],
  providers: [ChatService],
})
export class ChatModule {}
