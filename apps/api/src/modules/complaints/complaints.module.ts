import {
  BadRequestException,
  Body,
  ConflictException,
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
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { AdminOnly, type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { Database, type Tx } from '../../core/db/database.js';
import {
  COMPLAINT_RESOLUTIONS,
  COMPLAINT_TYPES,
  type ComplaintResolution,
  type ComplaintStatus,
  type ComplaintType,
} from '../../core/db/schema.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { emit } from '../../core/outbox/outbox.js';
import { UploadsService } from '../uploads/uploads.service.js';

/** How long after a ride ended the rider may still complain about it. */
export const COMPLAINT_WINDOW_DAYS = 7;
/** Photos per complaint (a lost bag, a dirty seat). */
export const MAX_COMPLAINT_PHOTOS = 3;

export const COMPLAINT_LABELS: Record<ComplaintType, string> = {
  lost_item: 'Mashinada narsa qoldi',
  driver_behaviour: 'Haydovchining xulqi',
  route: 'Yo‘l / manzil',
  price: 'Narx',
  car_condition: 'Mashina holati',
  safety: 'Xavfsizlik',
  other: 'Boshqa',
};

const Cursor = z.object({ cursor: z.uuid().optional() });
/** Uploads with the purpose complaint_photo (POST /uploads, then complete). */
const PhotoIds = z
  .array(z.uuid())
  .max(MAX_COMPLAINT_PHOTOS, `Ko‘pi bilan ${MAX_COMPLAINT_PHOTOS} ta rasm`)
  .default([]);
const ComplaintBody = z.object({
  type: z.enum(COMPLAINT_TYPES),
  text: z.string().trim().min(3).max(2000),
  photoUploadIds: PhotoIds,
});
const MessageBody = z.object({ text: z.string().trim().min(1).max(2000) });
const RiderMessageBody = MessageBody.extend({ photoUploadIds: PhotoIds });
const AdminQuery = Cursor.extend({
  status: z.enum(['open', 'in_progress', 'resolved', 'unresolved']).default('unresolved'),
  type: z.enum(COMPLAINT_TYPES).optional(),
  rideId: z.uuid().optional(),
  driverId: z.uuid().optional(),
});
const ResolveBody = z.object({
  resolution: z.enum(COMPLAINT_RESOLUTIONS),
  note: z.string().trim().min(1).max(1000).nullable().default(null),
});
const RatingsQuery = Cursor.extend({
  /** Whose rating: of drivers (by riders) or of riders (by drivers). */
  of: z.enum(['driver', 'rider']).optional(),
  maxStars: z.coerce.number().int().min(1).max(5).optional(),
  subjectId: z.uuid().optional(),
});

@Injectable()
export class ComplaintsService {
  constructor(
    private readonly db: Database,
    private readonly uploads: UploadsService,
  ) {}

  // Riders ----------------------------------------------------------------------------

  /** The rider's own ready complaint photos; anything else is refused. */
  private async checkPhotos(trx: Tx, userId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    for (const id of unique) {
      await this.uploads.requireAttachable(userId, id, ['complaint_photo'], trx);
    }
    return unique;
  }

  async create(
    user: AuthUser,
    rideId: string,
    input: { type: ComplaintType; text: string; photoUploadIds?: string[] },
  ) {
    const id = await this.db.transaction(async (trx) => {
      const ride = await trx
        .selectFrom('rides')
        .select(['id', 'rider_id', 'driver_id', 'status', 'completed_at', 'cancelled_at'])
        .where('id', '=', rideId)
        .where('rider_id', '=', user.userId)
        .forUpdate()
        .executeTakeFirst();
      if (!ride) throw new NotFoundException('Buyurtma topilmadi');
      const ended = ride.completed_at ?? ride.cancelled_at;
      if (ended && Date.now() - ended.getTime() > COMPLAINT_WINDOW_DAYS * 86_400_000) {
        throw new ConflictException(
          `Murojaat safardan keyin ${COMPLAINT_WINDOW_DAYS} kun ichida qabul qilinadi`,
        );
      }
      const same = await trx
        .selectFrom('complaints')
        .select('id')
        .where('ride_id', '=', rideId)
        .where('type', '=', input.type)
        .where('status', '!=', 'resolved')
        .executeTakeFirst();
      if (same) throw new ConflictException('Bu masala bo‘yicha murojaatingiz ko‘rib chiqilmoqda');
      const photos = await this.checkPhotos(trx, user.userId, input.photoUploadIds ?? []);
      const complaintId = uuidv7();
      await trx
        .insertInto('complaints')
        .values({
          id: complaintId,
          ride_id: rideId,
          rider_id: user.userId,
          driver_id: ride.driver_id,
          type: input.type,
          text: input.text,
          photo_upload_ids: photos,
          updated_at: new Date(),
        })
        .execute();
      await this.changed(trx, complaintId, rideId, user.userId, 'open', 'rider');
      return complaintId;
    });
    return this.riderView(user, id);
  }

  async riderList(user: AuthUser, cursor?: string) {
    const rows = await this.db.kysely
      .selectFrom('complaints as c')
      .innerJoin('rides as r', 'r.id', 'c.ride_id')
      .select([
        'c.id',
        'c.ride_id as rideId',
        'r.number as rideNumber',
        'c.type',
        'c.status',
        'c.resolution',
        'c.created_at as createdAt',
        'c.updated_at as updatedAt',
      ])
      .where('c.rider_id', '=', user.userId)
      .$if(Boolean(cursor), (q) => q.where('c.id', '<', cursor!))
      .orderBy('c.id', 'desc')
      .limit(30)
      .execute();
    return {
      items: rows.map((r) => ({ ...r, typeLabel: COMPLAINT_LABELS[r.type] })),
      nextCursor: rows.length === 30 ? rows.at(-1)!.id : null,
    };
  }

  async riderView(user: AuthUser, id: string) {
    const view = await this.view(id);
    if (view.riderId !== user.userId) throw new NotFoundException('Murojaat topilmadi');
    // the rider sees the outcome, not who handled it
    const { resolvedBy: _by, driverId: _driver, ...mine } = view;
    return mine;
  }

  /** The rider writes in the thread, optionally adding photos (up to three in all). */
  async riderReply(user: AuthUser, id: string, text: string, photoUploadIds: string[] = []) {
    await this.db.transaction(async (trx) => {
      const c = await this.lock(trx, id);
      if (c.rider_id !== user.userId) throw new NotFoundException('Murojaat topilmadi');
      if (c.status === 'resolved') throw new ConflictException('Murojaat yopilgan');
      if (photoUploadIds.length) {
        const added = await this.checkPhotos(trx, user.userId, photoUploadIds);
        const all = [...new Set([...c.photo_upload_ids, ...added])];
        if (all.length > MAX_COMPLAINT_PHOTOS) {
          throw new BadRequestException(
            `Bitta murojaatga ko‘pi bilan ${MAX_COMPLAINT_PHOTOS} ta rasm qo‘shiladi`,
          );
        }
        await trx
          .updateTable('complaints')
          .set({ photo_upload_ids: all })
          .where('id', '=', id)
          .execute();
      }
      await this.message(trx, id, user.userId, 'rider', text);
      await this.changed(trx, id, c.ride_id, c.rider_id, c.status, 'rider');
    });
    return this.riderView(user, id);
  }

  // Operators ---------------------------------------------------------------------------

  async adminList(q: z.output<typeof AdminQuery>) {
    const rows = await this.db.kysely
      .selectFrom('complaints as c')
      .innerJoin('rides as r', 'r.id', 'c.ride_id')
      .select([
        'c.id',
        'c.ride_id as rideId',
        'r.number as rideNumber',
        'r.rider_phone as riderPhone',
        'c.driver_id as driverId',
        'c.type',
        'c.status',
        'c.text',
        'c.resolution',
        'c.created_at as createdAt',
        'c.updated_at as updatedAt',
      ])
      .$if(q.status === 'unresolved', (x) => x.where('c.status', '!=', 'resolved'))
      .$if(q.status !== 'unresolved', (x) => x.where('c.status', '=', q.status as ComplaintStatus))
      .$if(Boolean(q.type), (x) => x.where('c.type', '=', q.type!))
      .$if(Boolean(q.rideId), (x) => x.where('c.ride_id', '=', q.rideId!))
      .$if(Boolean(q.driverId), (x) => x.where('c.driver_id', '=', q.driverId!))
      .$if(Boolean(q.cursor), (x) => x.where('c.id', '<', q.cursor!))
      .orderBy('c.id', 'desc')
      .limit(100)
      .execute();
    return {
      items: rows.map((r) => ({ ...r, typeLabel: COMPLAINT_LABELS[r.type] })),
      nextCursor: rows.length === 100 ? rows.at(-1)!.id : null,
    };
  }

  /** An operator answers: the complaint is being handled. */
  async adminReply(admin: AuthUser, id: string, text: string) {
    await this.db.transaction(async (trx) => {
      const c = await this.lock(trx, id);
      if (c.status === 'resolved') throw new ConflictException('Murojaat yopilgan');
      await this.message(trx, id, admin.userId, 'admin', text);
      await trx
        .updateTable('complaints')
        .set({ status: 'in_progress', updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await this.changed(trx, id, c.ride_id, c.rider_id, 'in_progress', 'operator');
    });
    return this.view(id);
  }

  async resolve(
    admin: AuthUser,
    id: string,
    input: { resolution: ComplaintResolution; note: string | null },
  ) {
    await this.db.transaction(async (trx) => {
      const c = await this.lock(trx, id);
      if (c.status === 'resolved') throw new ConflictException('Murojaat allaqachon yopilgan');
      const now = new Date();
      await trx
        .updateTable('complaints')
        .set({
          status: 'resolved',
          resolution: input.resolution,
          resolution_note: input.note,
          resolved_by: admin.userId,
          resolved_at: now,
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
      await this.changed(trx, id, c.ride_id, c.rider_id, 'resolved', 'operator');
    });
    return this.view(id);
  }

  /** Ratings for operators: the low ones of a driver, of riders, with the ride. */
  async ratings(q: z.output<typeof RatingsQuery>) {
    const rows = await this.db.kysely
      .selectFrom('ratings as g')
      .innerJoin('rides as r', 'r.id', 'g.ride_id')
      .innerJoin('users as a', 'a.id', 'g.author_id')
      .innerJoin('users as s', 's.id', 'g.subject_id')
      .select([
        'g.id',
        'g.ride_id as rideId',
        'r.number as rideNumber',
        'g.author_role as authorRole',
        'g.author_id as authorId',
        'a.full_name as authorName',
        'g.subject_id as subjectId',
        's.full_name as subjectName',
        's.phone as subjectPhone',
        'g.stars',
        'g.tags',
        'g.comment',
        'g.created_at as createdAt',
      ])
      // "of driver" = written by riders
      .$if(q.of === 'driver', (x) => x.where('g.author_role', '=', 'rider'))
      .$if(q.of === 'rider', (x) => x.where('g.author_role', '=', 'driver'))
      .$if(q.maxStars !== undefined, (x) => x.where('g.stars', '<=', q.maxStars!))
      .$if(Boolean(q.subjectId), (x) => x.where('g.subject_id', '=', q.subjectId!))
      .$if(Boolean(q.cursor), (x) => x.where('g.id', '<', q.cursor!))
      .orderBy('g.id', 'desc')
      .limit(100)
      .execute();
    return { items: rows, nextCursor: rows.length === 100 ? rows.at(-1)!.id : null };
  }

  // Shared ------------------------------------------------------------------------------

  async view(id: string) {
    const c = await this.db.kysely
      .selectFrom('complaints as c')
      .innerJoin('rides as r', 'r.id', 'c.ride_id')
      .select([
        'c.id',
        'c.ride_id',
        'r.number',
        'c.rider_id',
        'c.driver_id',
        'c.type',
        'c.status',
        'c.text',
        'c.resolution',
        'c.resolution_note',
        'c.resolved_by',
        'c.resolved_at',
        'c.photo_upload_ids',
        'c.created_at',
      ])
      .where('c.id', '=', id)
      .executeTakeFirst();
    if (!c) throw new NotFoundException('Murojaat topilmadi');
    const urls = await this.uploads.readUrls(c.photo_upload_ids);
    const messages = await this.db.kysely
      .selectFrom('complaint_messages')
      .select(['id', 'author_role as authorRole', 'text', 'created_at as at'])
      .where('complaint_id', '=', id)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return {
      id: c.id,
      rideId: c.ride_id,
      rideNumber: c.number,
      riderId: c.rider_id,
      driverId: c.driver_id,
      type: c.type,
      typeLabel: COMPLAINT_LABELS[c.type],
      status: c.status,
      text: c.text,
      resolution: c.resolution,
      resolutionNote: c.resolution_note,
      resolvedBy: c.resolved_by,
      resolvedAt: c.resolved_at,
      createdAt: c.created_at,
      // short-lived read URLs (private bucket) for the rider and operators
      photos: c.photo_upload_ids.map((uploadId) => ({ uploadId, url: urls.get(uploadId) ?? null })),
      messages,
    };
  }

  private async lock(trx: Tx, id: string) {
    const c = await trx
      .selectFrom('complaints')
      .select(['id', 'ride_id', 'rider_id', 'status', 'photo_upload_ids'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!c) throw new NotFoundException('Murojaat topilmadi');
    return c;
  }

  private async message(
    trx: Tx,
    complaintId: string,
    authorId: string,
    role: 'rider' | 'admin',
    text: string,
  ) {
    await trx
      .insertInto('complaint_messages')
      .values({
        id: uuidv7(),
        complaint_id: complaintId,
        author_id: authorId,
        author_role: role,
        text,
      })
      .execute();
    await trx
      .updateTable('complaints')
      .set({ updated_at: sql`now()` })
      .where('id', '=', complaintId)
      .execute();
  }

  private async changed(
    trx: Tx,
    complaintId: string,
    rideId: string,
    riderId: string,
    status: ComplaintStatus,
    by: 'rider' | 'operator',
  ) {
    await emit(trx, 'complaint.changed', { complaintId, rideId, riderId, status, by });
  }
}

/** Riders: complaints (support tickets) about their rides, lost items included. */
@Controller()
export class RiderComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Post('rides/:id/complaints')
  @RateLimit({ name: 'complaints:create', by: 'user', max: 20, windowSeconds: 3600 })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ComplaintBody)) body: z.output<typeof ComplaintBody>,
  ) {
    return this.complaints.create(user, id, body);
  }

  @Get('complaints')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(Cursor)) q: z.output<typeof Cursor>) {
    return this.complaints.riderList(user, q.cursor);
  }

  @Get('complaints/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.complaints.riderView(user, id);
  }

  @Post('complaints/:id/messages')
  @RateLimit({ name: 'complaints:reply', by: 'user', max: 60, windowSeconds: 3600 })
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RiderMessageBody)) body: z.output<typeof RiderMessageBody>,
  ) {
    return this.complaints.riderReply(user, id, body.text, body.photoUploadIds);
  }
}

/** Operators: the complaints inbox and the ratings list. */
@Controller('admin')
@AdminOnly()
export class AdminComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  /** Unresolved first by default; filter by status, type, ride or driver. */
  @Get('complaints')
  list(@Query(new ZodPipe(AdminQuery)) q: z.output<typeof AdminQuery>) {
    return this.complaints.adminList(q);
  }

  @Get('complaints/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.complaints.view(id);
  }

  @Post('complaints/:id/messages')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(MessageBody)) body: z.output<typeof MessageBody>,
  ) {
    return this.complaints.adminReply(user, id, body.text);
  }

  @Post('complaints/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ResolveBody)) body: z.output<typeof ResolveBody>,
  ) {
    return this.complaints.resolve(user, id, body);
  }

  /** Ratings both ways, newest first; ?of=driver&maxStars=3 for low driver ratings. */
  @Get('ratings')
  ratings(@Query(new ZodPipe(RatingsQuery)) q: z.output<typeof RatingsQuery>) {
    return this.complaints.ratings(q);
  }
}

@Module({
  controllers: [RiderComplaintsController, AdminComplaintsController],
  providers: [ComplaintsService],
})
export class ComplaintsModule {}
