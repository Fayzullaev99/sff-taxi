import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../../config/env.js';

export interface ObjectStorageConfig {
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  /** Omit for AWS; set for any other S3-compatible service. */
  endpoint?: string;
  /** Endpoint the apps use for presigned URLs, if different from the API's. */
  publicEndpoint?: string;
}

export interface StoredObject {
  size: number;
  contentType: string | undefined;
}

/** The storage settings from the environment, or null while uploads are not configured. */
export function storageConfig(env: Env): ObjectStorageConfig | null {
  if (!env.STORAGE_S3_BUCKET || !env.STORAGE_S3_ACCESS_KEY || !env.STORAGE_S3_SECRET_KEY) {
    return null;
  }
  return {
    bucket: env.STORAGE_S3_BUCKET,
    region: env.STORAGE_S3_REGION,
    accessKey: env.STORAGE_S3_ACCESS_KEY,
    secretKey: env.STORAGE_S3_SECRET_KEY,
    endpoint: env.STORAGE_S3_ENDPOINT,
    publicEndpoint: env.STORAGE_S3_PUBLIC_ENDPOINT,
  };
}

/**
 * Thin wrapper over a private S3-compatible bucket: presigned PUTs and GETs plus the
 * server-side checks. Copied from SFF Eats (whose bucket is public) with presigned reads.
 */
export class ObjectStorage {
  private readonly server: S3Client;
  private readonly presigner: S3Client;

  constructor(readonly config: ObjectStorageConfig) {
    const base = (endpoint?: string): S3ClientConfig => ({
      region: config.region,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      // Otherwise the SDK bakes a CRC32 of the *empty* body into presigned PUT URLs, which
      // S3-compatible services (SeaweedFS, MinIO) then reject.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    this.server = new S3Client(base(config.endpoint));
    this.presigner = new S3Client(base(config.publicEndpoint ?? config.endpoint));
  }

  /**
   * URL for a single PUT. Content-Type and Content-Length are part of the signature,
   * so the storage refuses a body of another size or type.
   */
  presignPut(key: string, contentType: string, size: number, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.presigner,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
        CacheControl: 'private, max-age=31536000, immutable',
      }),
      { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  /** A short-lived read URL; the bucket itself is not readable without one. */
  presignGet(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.presigner,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn },
    );
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.server.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** First bytes of an object, for checking its real type by signature. */
  async readPrefix(key: string, length: number): Promise<Buffer> {
    const res = await this.server.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Range: `bytes=0-${length - 1}`,
      }),
    );
    return Buffer.from((await res.Body?.transformToByteArray()) ?? []);
  }

  async delete(key: string): Promise<void> {
    await this.server.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  /** Development and tests; production buckets come from ops (docs/deploy.md). */
  async ensureBucket(): Promise<void> {
    try {
      await this.server.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await this.server.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }
  }
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'NotFound' ||
    e.name === 'NoSuchKey' ||
    e.name === 'NoSuchBucket' ||
    e.$metadata?.httpStatusCode === 404
  );
}
