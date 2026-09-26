import {
  Body,
  Controller,
  Get,
  Global,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { type AuthUser, CurrentUser } from '../../core/auth/auth-context.js';
import { UPLOAD_PURPOSES, type UploadContentType } from '../../core/db/schema.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { FILE_TYPES } from './file-types.js';
import { ObjectStorage, storageConfig } from './object-storage.js';
import { OBJECT_STORAGE, UploadsService } from './uploads.service.js';

const TYPES = Object.keys(FILE_TYPES) as [UploadContentType, ...UploadContentType[]];

const CreateUploadBody = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  contentType: z.enum(TYPES, { error: 'Faqat JPEG, PNG, WebP rasm yoki PDF yuklash mumkin' }),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024, 'Fayl hajmi 10 MB dan oshmasin'),
});

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Whether uploads work here, and what each purpose accepts. */
  @Get('config')
  config() {
    return this.uploads.config();
  }

  /** A presigned PUT for one file; then PUT the bytes and call complete. */
  @Post()
  @RateLimit({ name: 'uploads', by: 'user', max: 60, windowSeconds: 3600 })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(CreateUploadBody)) body: z.output<typeof CreateUploadBody>,
  ) {
    return this.uploads.create(user, body);
  }

  /** Checks the stored bytes (size and file signature) and marks the upload ready. */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.complete(user, id);
  }

  /** The owner (or an operator) reads the file through a short-lived URL. */
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.get(user, id);
  }
}

/** Creates the development bucket on start; production buckets are provisioned by ops. */
@Injectable()
export class DevBucket implements OnApplicationBootstrap {
  private readonly logger = new Logger(DevBucket.name);
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.storage || this.env.NODE_ENV !== 'development') return;
    await this.storage.ensureBucket().catch((error: Error) => {
      this.logger.warn(`Object storage unreachable: ${error.message}`);
    });
  }
}

/** Driver documents and photos in a private S3-compatible bucket (presigned PUT and GET). */
@Global()
@Module({
  controllers: [UploadsController],
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [ENV],
      useFactory: (env: Env) => {
        const config = storageConfig(env);
        return config ? new ObjectStorage(config) : null;
      },
    },
    UploadsService,
    DevBucket,
  ],
  exports: [OBJECT_STORAGE, UploadsService],
})
export class UploadsModule {}
