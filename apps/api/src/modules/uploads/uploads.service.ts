import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Selectable } from 'kysely';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { AuthUser } from '../../core/auth/auth-context.js';
import { Database, type Tx } from '../../core/db/database.js';
import type { UploadContentType, UploadPurpose, UploadsTable } from '../../core/db/schema.js';
import {
  detectFileType,
  MAX_BYTES,
  objectKey,
  PURPOSE_TYPES,
  SIGNATURE_LENGTH,
} from './file-types.js';
import type { ObjectStorage } from './object-storage.js';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** How long a presigned PUT stays valid. */
export const UPLOAD_URL_TTL_SECONDS = 600;
/** How long a presigned read URL in a view stays valid: apps refetch views far more often. */
export const READ_URL_TTL_SECONDS = 900;
/** Uploads never completed are deleted after this long (housekeeping job). */
export const PENDING_UPLOAD_TTL_HOURS = 24;

type Db = Tx | Database['kysely'];
type Upload = Selectable<UploadsTable>;

export interface CreateUploadInput {
  purpose: UploadPurpose;
  contentType: UploadContentType;
  sizeBytes: number;
}

/**
 * Files straight to a private S3-compatible bucket: the app asks for a presigned PUT, sends
 * the bytes to the storage itself (the API never proxies them), then asks the API to check
 * what landed. Reads are presigned too, handed out only to whoever may see the file.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null,
  ) {}

  config() {
    return {
      enabled: this.storage !== null,
      purposes: Object.fromEntries(
        (Object.keys(PURPOSE_TYPES) as UploadPurpose[]).map((p) => [
          p,
          { contentTypes: PURPOSE_TYPES[p], maxBytes: MAX_BYTES[p] },
        ]),
      ),
    };
  }

  /** Registers an upload and returns a short-lived URL to PUT the bytes to. */
  async create(user: AuthUser, input: CreateUploadInput) {
    const storage = this.requireStorage();
    if (!PURPOSE_TYPES[input.purpose].includes(input.contentType)) {
      throw new BadRequestException('Bu turdagi fayl uchun faqat JPEG, PNG yoki WebP rasm mumkin');
    }
    if (input.sizeBytes > MAX_BYTES[input.purpose]) {
      throw new BadRequestException(
        `Fayl hajmi ${MAX_BYTES[input.purpose] / 1024 / 1024} MB dan oshmasin`,
      );
    }
    const id = uuidv7();
    const key = objectKey(
      user.userId,
      input.purpose,
      randomBytes(16).toString('base64url'),
      input.contentType,
    );
    await this.db.kysely
      .insertInto('uploads')
      .values({
        id,
        owner_id: user.userId,
        purpose: input.purpose,
        object_key: key,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
      })
      .execute();
    const uploadUrl = await storage.presignPut(
      key,
      input.contentType,
      input.sizeBytes,
      UPLOAD_URL_TTL_SECONDS,
    );
    return {
      id,
      purpose: input.purpose,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      status: 'pending' as const,
      upload: {
        method: 'PUT' as const,
        url: uploadUrl,
        // exactly these: they are part of the signature (the client adds Content-Length)
        headers: { 'Content-Type': input.contentType },
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      },
    };
  }

  /**
   * Called after the PUT: checks what actually landed in the bucket. An object of another
   * size, or whose bytes are not the declared type, is deleted with its row.
   */
  async complete(user: AuthUser, id: string) {
    const row = await this.find(id);
    if (!row || row.owner_id !== user.userId) throw new NotFoundException('Fayl topilmadi');
    const storage = this.requireStorage();
    if (row.status === 'ready') return this.view(row);

    const stored = await storage.head(row.object_key);
    if (!stored) throw new ConflictException('Fayl hali yuklanmagan');
    const actual = detectFileType(await storage.readPrefix(row.object_key, SIGNATURE_LENGTH));
    if (stored.size !== row.size_bytes || actual !== row.content_type) {
      await storage.delete(row.object_key);
      await this.db.kysely.deleteFrom('uploads').where('id', '=', id).execute();
      throw new BadRequestException(
        'Fayl buzilgan yoki e’lon qilingan turga mos emas: JPEG, PNG, WebP yoki PDF yuklang',
      );
    }
    const ready = await this.db.kysely
      .updateTable('uploads')
      .set({ status: 'ready', completed_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.view(ready);
  }

  /** The owner and operators read any of their files. */
  async get(user: AuthUser, id: string) {
    const row = await this.find(id);
    if (!row || (row.owner_id !== user.userId && !user.isAdmin)) {
      throw new NotFoundException('Fayl topilmadi');
    }
    return this.view(row);
  }

  /**
   * A ready upload of `ownerId` for one of `purposes`, to attach to a profile (a document,
   * the driver's photo, the car's photo). Anything else is refused.
   */
  async requireAttachable(
    ownerId: string,
    id: string,
    purposes: readonly UploadPurpose[],
    db: Db = this.db.kysely,
  ): Promise<Upload> {
    const row = await this.find(id, db);
    if (!row || row.owner_id !== ownerId) throw new NotFoundException('Fayl topilmadi');
    if (row.status !== 'ready') throw new ConflictException('Fayl yuklanishi tugallanmagan');
    if (!purposes.includes(row.purpose)) {
      throw new BadRequestException('Bu fayl boshqa maqsad uchun yuklangan');
    }
    return row;
  }

  /** A presigned read URL for a ready upload, or null (not configured, missing, pending). */
  async readUrl(id: string | null, db: Db = this.db.kysely): Promise<string | null> {
    if (!id || !this.storage) return null;
    const row = await this.find(id, db);
    return row?.status === 'ready' ? this.presign(row) : null;
  }

  /** Read URLs for several uploads at once (a driver's documents). */
  async readUrls(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = ids.filter((x): x is string => Boolean(x));
    if (!wanted.length || !this.storage) return new Map();
    const rows = await this.db.kysely
      .selectFrom('uploads')
      .selectAll()
      .where('id', 'in', wanted)
      .where('status', '=', 'ready')
      .execute();
    const out = new Map<string, string>();
    for (const r of rows) out.set(r.id, await this.presign(r));
    return out;
  }

  /** Deletes uploads that were started and never completed; returns how many. */
  async removeAbandoned(limit = 100, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - PENDING_UPLOAD_TTL_HOURS * 3_600_000);
    const rows = await this.db.kysely
      .selectFrom('uploads')
      .select(['id', 'object_key'])
      .where('status', '=', 'pending')
      .where('created_at', '<', cutoff)
      .orderBy('created_at')
      .limit(limit)
      .execute();
    for (const r of rows) {
      // the bytes may or may not have arrived: delete both
      if (this.storage) {
        await this.storage.delete(r.object_key).catch((error: Error) => {
          this.logger.warn(`Could not delete ${r.object_key}: ${error.message}`);
        });
      }
      await this.db.kysely
        .deleteFrom('uploads')
        .where('id', '=', r.id)
        .where('status', '=', 'pending')
        .execute();
    }
    return rows.length;
  }

  private async view(row: Upload) {
    return {
      id: row.id,
      purpose: row.purpose,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      status: row.status,
      url: row.status === 'ready' && this.storage ? await this.presign(row) : null,
      createdAt: row.created_at,
    };
  }

  private presign(row: Upload): Promise<string> {
    return this.requireStorage().presignGet(row.object_key, READ_URL_TTL_SECONDS);
  }

  private find(id: string, db: Db = this.db.kysely) {
    return db.selectFrom('uploads').selectAll().where('id', '=', id).executeTakeFirst();
  }

  private requireStorage(): ObjectStorage {
    if (!this.storage) {
      throw new ServiceUnavailableException('Fayl yuklash serverda hali sozlanmagan');
    }
    return this.storage;
  }
}
