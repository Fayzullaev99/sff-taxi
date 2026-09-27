import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { Database } from '../../core/db/database.js';
import { PLACE_KINDS, type PlaceKind, type RiderPlacesTable } from '../../core/db/schema.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';

/** Home, work and up to 18 others. */
export const MAX_PLACES = 20;
/** Distinct recent destinations offered from ride history. */
const RECENT = 10;

const Lat = z.number().min(-90).max(90);
const Lng = z.number().min(-180).max(180);
const Text = (max: number) => z.string().trim().min(1).max(max).nullable();

// No .default() anywhere: the PATCH schema is its .partial(), and zod 4 re-applies inner
// defaults inside .partial() (an SFF Eats lesson): a rename would reset the address.
const PlaceFields = z.object({
  kind: z.enum(PLACE_KINDS),
  label: Text(60),
  address: Text(300),
  landmark: Text(200),
  lat: Lat,
  lng: Lng,
});
const CreatePlace = PlaceFields.partial({ label: true, address: true, landmark: true });
const UpdatePlace = PlaceFields.omit({ kind: true }).partial();

type Place = Selectable<RiderPlacesTable>;

function view(p: Place) {
  return {
    id: p.id,
    kind: p.kind,
    label: p.label,
    address: p.address,
    landmark: p.landmark,
    lat: p.lat,
    lng: p.lng,
    updatedAt: p.updated_at,
  };
}

@Injectable()
export class PlacesService {
  constructor(private readonly db: Database) {}

  async list(userId: string) {
    const rows = await this.db.kysely
      .selectFrom('rider_places')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at')
      .execute();
    // home and work first
    const order: Record<PlaceKind, number> = { home: 0, work: 1, other: 2 };
    return rows.sort((a, b) => order[a.kind] - order[b.kind]).map(view);
  }

  /** Adds a place; home and work replace the previous one. */
  async create(user: AuthUser, input: z.output<typeof CreatePlace>) {
    const values = {
      label: input.label ?? null,
      address: input.address ?? null,
      landmark: input.landmark ?? null,
      lat: input.lat,
      lng: input.lng,
      updated_at: new Date(),
    };
    const row = await this.db.transaction(async (trx) => {
      if (input.kind !== 'other') {
        const replaced = await trx
          .updateTable('rider_places')
          .set(values)
          .where('user_id', '=', user.userId)
          .where('kind', '=', input.kind)
          .returningAll()
          .executeTakeFirst();
        if (replaced) return replaced;
      }
      const count = await trx
        .selectFrom('rider_places')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('user_id', '=', user.userId)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_PLACES) {
        throw new ConflictException(`Ko‘pi bilan ${MAX_PLACES} ta manzil saqlash mumkin`);
      }
      return trx
        .insertInto('rider_places')
        .values({ id: uuidv7(), user_id: user.userId, kind: input.kind, ...values })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return view(row);
  }

  async update(user: AuthUser, id: string, input: z.output<typeof UpdatePlace>) {
    const row = await this.db.kysely
      .updateTable('rider_places')
      .set({ ...input, updated_at: new Date() })
      .where('id', '=', id)
      .where('user_id', '=', user.userId)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Manzil topilmadi');
    return view(row);
  }

  async remove(user: AuthUser, id: string) {
    const res = await this.db.kysely
      .deleteFrom('rider_places')
      .where('id', '=', id)
      .where('user_id', '=', user.userId)
      .executeTakeFirst();
    if (!res.numDeletedRows) throw new NotFoundException('Manzil topilmadi');
  }

  /**
   * Where the rider went lately: drop-offs of recent rides, one per place (about 11 m apart
   * counts as the same), newest first.
   */
  async recent(userId: string) {
    const [rows, hidden] = await Promise.all([
      this.db.kysely
        .selectFrom('rides')
        .select(['dropoff', 'dropoff_lat', 'dropoff_lng', 'requested_at'])
        .where('rider_id', '=', userId)
        .orderBy('requested_at', 'desc')
        .limit(50)
        .execute(),
      this.db.kysely
        .selectFrom('rider_hidden_places')
        .select(['place_key', 'created_at'])
        .where('user_id', '=', userId)
        .execute(),
    ]);
    // a hidden place stays hidden until the rider goes there again
    const hiddenAt = new Map(hidden.map((h) => [h.place_key, h.created_at.getTime()]));
    const seen = new Set<string>();
    const out: {
      key: string;
      address: string | null;
      landmark: string | null;
      lat: number;
      lng: number;
      lastUsedAt: Date;
    }[] = [];
    for (const r of rows) {
      const k = placeKey(r.dropoff_lat, r.dropoff_lng);
      if (seen.has(k)) continue;
      seen.add(k);
      if ((hiddenAt.get(k) ?? -1) >= r.requested_at.getTime()) continue;
      out.push({
        key: k,
        address: r.dropoff.address,
        landmark: r.dropoff.landmark,
        lat: r.dropoff_lat,
        lng: r.dropoff_lng,
        lastUsedAt: r.requested_at,
      });
      if (out.length === RECENT) break;
    }
    return out;
  }

  /**
   * Removes a destination from the recent list (the ride history stays): by its `key` from
   * the list, or by its coordinates. A later ride there brings it back.
   */
  async hideRecent(userId: string, at: { key?: string; lat?: number; lng?: number }) {
    const key = at.key ?? placeKey(at.lat!, at.lng!);
    await this.db.kysely
      .insertInto('rider_hidden_places')
      .values({ user_id: userId, place_key: key })
      .onConflict((oc) =>
        oc.columns(['user_id', 'place_key']).doUpdateSet({ created_at: sql`now()` }),
      )
      .execute();
  }

  /** Shows every hidden destination again. */
  async unhideAll(userId: string) {
    await this.db.kysely.deleteFrom('rider_hidden_places').where('user_id', '=', userId).execute();
  }
}

/** Destinations about 11 m apart are the same place: "40.4960,68.7759". */
export function placeKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

const HideBody = z
  .object({
    key: z
      .string()
      .regex(/^-?\d+\.\d{4},-?\d+\.\d{4}$/, 'key: GET places/recent dagi qiymat')
      .optional(),
    lat: Lat.optional(),
    lng: Lng.optional(),
  })
  .refine((b) => b.key !== undefined || (b.lat !== undefined && b.lng !== undefined), {
    message: 'key yoki lat va lng yuboring',
    path: ['key'],
  });

/** Riders' saved places and recent destinations. */
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.places.list(user.userId);
  }

  /** Recent destinations from the rider's rides, newest first. */
  @Get('recent')
  recent(@CurrentUser() user: AuthUser) {
    return this.places.recent(user.userId);
  }

  /** Hides a recent destination: `{ key }` from the list, or `{ lat, lng }`. */
  @Post('recent/hide')
  @HttpCode(HttpStatus.NO_CONTENT)
  async hideRecent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(HideBody)) body: z.output<typeof HideBody>,
  ) {
    await this.places.hideRecent(user.userId, body);
  }

  /** Brings every hidden recent destination back. */
  @Delete('recent/hidden')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unhideAll(@CurrentUser() user: AuthUser) {
    await this.places.unhideAll(user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(CreatePlace)) body: z.output<typeof CreatePlace>,
  ) {
    return this.places.create(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdatePlace)) body: z.output<typeof UpdatePlace>,
  ) {
    return this.places.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.places.remove(user, id);
  }
}

@Module({
  controllers: [PlacesController],
  providers: [PlacesService],
  exports: [PlacesService],
})
export class PlacesModule {}
