import { isApiError } from './api-client';

/**
 * Uploading a document or a photo (API `uploads` module, architecture §12):
 *
 *   prepare (pick, resize/compress) → request (`POST /v1/uploads`: a presigned PUT)
 *   → put (the bytes straight to the bucket, with progress) → complete
 *   (`POST /v1/uploads/:id/complete`: the API checks size and file signature)
 *   → attach (`PUT /v1/driver/documents/:kind`, `/driver/photo`, `/driver/vehicle/photo`).
 *
 * `runUpload` drives one attempt and remembers how far it got (`UploadMemo`), so "Qayta
 * urinish" continues where it failed: a failed attach does not upload the photo again,
 * an interrupted PUT reuses the presigned URL while it is valid. No React Native imports:
 * the steps are injected, so the whole flow is unit-tested under Node.
 */

export type UploadPurpose = 'document' | 'profile_photo' | 'vehicle_photo';
export type UploadContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export interface PurposeLimits {
  contentTypes: UploadContentType[];
  maxBytes: number;
}

export interface UploadsConfig {
  enabled: boolean;
  purposes: Record<UploadPurpose, PurposeLimits>;
}

const IMAGES: UploadContentType[] = ['image/jpeg', 'image/png', 'image/webp'];
const MB = 1024 * 1024;

/** The API's limits (uploads/file-types.ts) until `GET /v1/uploads/config` answers. */
export const DEFAULT_UPLOADS_CONFIG: UploadsConfig = {
  enabled: true,
  purposes: {
    document: { contentTypes: [...IMAGES, 'application/pdf'], maxBytes: 10 * MB },
    profile_photo: { contentTypes: IMAGES, maxBytes: 5 * MB },
    vehicle_photo: { contentTypes: IMAGES, maxBytes: 5 * MB },
  },
};

const TYPES: UploadContentType[] = [...IMAGES, 'application/pdf'];
const isType = (v: unknown): v is UploadContentType => TYPES.includes(v as UploadContentType);

/** `GET /v1/uploads/config` → limits per purpose (defaults for anything missing). */
export function mapUploadsConfig(raw: unknown): UploadsConfig {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const purposes = (r.purposes && typeof r.purposes === 'object' ? r.purposes : {}) as Record<
    string,
    unknown
  >;
  const out = { ...DEFAULT_UPLOADS_CONFIG.purposes };
  for (const p of Object.keys(out) as UploadPurpose[]) {
    const v = purposes[p] as { contentTypes?: unknown; maxBytes?: unknown } | undefined;
    if (!v) continue;
    const types = Array.isArray(v.contentTypes) ? v.contentTypes.filter(isType) : [];
    out[p] = {
      contentTypes: types.length ? types : out[p].contentTypes,
      maxBytes: typeof v.maxBytes === 'number' && v.maxBytes > 0 ? v.maxBytes : out[p].maxBytes,
    };
  }
  return { enabled: typeof r.enabled === 'boolean' ? r.enabled : true, purposes: out };
}

/** The accepted type of a picked file from its MIME type or, failing that, its name. */
export function contentTypeOf(
  mime: string | null | undefined,
  name?: string | null,
): UploadContentType | null {
  const m = mime?.toLowerCase().trim();
  if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg';
  if (isType(m)) return m;
  const ext = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(name ?? '')?.[1]?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'pdf') return 'application/pdf';
  return null;
}

/**
 * Longest side of a photo after resizing, per purpose: a document stays readable at
 * 2000 px, faces and cars are shown small. Each further pass (when the file is still over
 * the limit) shrinks it and lowers the JPEG quality.
 */
export const IMAGE_PASSES: Record<UploadPurpose, { maxSide: number; quality: number }[]> = {
  document: [
    { maxSide: 2000, quality: 0.7 },
    { maxSide: 1600, quality: 0.55 },
    { maxSide: 1280, quality: 0.45 },
  ],
  profile_photo: [
    { maxSide: 1080, quality: 0.7 },
    { maxSide: 800, quality: 0.55 },
    { maxSide: 640, quality: 0.45 },
  ],
  vehicle_photo: [
    { maxSide: 1600, quality: 0.7 },
    { maxSide: 1280, quality: 0.55 },
    { maxSide: 1024, quality: 0.45 },
  ],
};

/** The resize that fits `maxSide` (only the longer side is given), or null when it fits. */
export function resizeFor(
  width: number,
  height: number,
  maxSide: number,
): { width: number } | { height: number } | null {
  if (!(width > 0 && height > 0) || Math.max(width, height) <= maxSide) return null;
  return width >= height ? { width: maxSide } : { height: maxSide };
}

/** Why a prepared file cannot be sent (Uzbek), or null. */
export function fileProblem(
  file: { contentType: UploadContentType; sizeBytes: number },
  limits: PurposeLimits,
): string | null {
  if (!limits.contentTypes.includes(file.contentType)) {
    return limits.contentTypes.includes('application/pdf')
      ? 'Faqat rasm (JPEG, PNG, WebP) yoki PDF yuklash mumkin'
      : 'Faqat rasm (JPEG, PNG, WebP) yuklash mumkin';
  }
  if (!(file.sizeBytes > 0)) return 'Fayl bo‘sh yoki o‘qib bo‘lmadi';
  if (file.sizeBytes > limits.maxBytes) {
    return `Fayl juda katta: ${megabytes(file.sizeBytes)} MB, ko‘pi bilan ${megabytes(limits.maxBytes)} MB`;
  }
  return null;
}

/** 5242880 → "5", 1572864 → "1,5" */
export function megabytes(bytes: number): string {
  const v = Math.round((bytes / MB) * 10) / 10;
  return String(v).replace('.', ',');
}

export interface LocalFile {
  uri: string;
  contentType: UploadContentType;
  sizeBytes: number;
}

/** `POST /v1/uploads` answer. */
export interface CreatedUpload {
  id: string;
  upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresInSeconds: number };
}

/** The storage refused the PUT (HTTP status; 0 = no answer). */
export class PutFailed extends Error {
  constructor(readonly status: number) {
    super(status ? `PUT ${status}` : 'PUT failed');
    this.name = 'PutFailed';
  }
}

/** A step of the flow gave up with a message for the driver (e.g. the file is too big). */
export class UploadRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRefused';
  }
}

export type UploadStep = 'prepare' | 'request' | 'put' | 'complete' | 'attach';

export type UploadState =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'requesting' }
  | { status: 'uploading'; progress: number }
  | { status: 'completing' }
  | { status: 'attaching' }
  | { status: 'done'; uploadId: string }
  | { status: 'failed'; step: UploadStep; message: string; retryable: boolean };

/** How far an upload got: kept between attempts so a retry does not start over. */
export interface UploadMemo {
  file?: LocalFile;
  upload?: { id: string; url: string; headers: Record<string, string>; expiresAt: number };
  put?: boolean;
  completed?: boolean;
}

export interface UploadDeps<T> {
  /** Pick/prepare the file (resize, compress, read its size). Null: the driver cancelled. */
  prepare(): Promise<LocalFile | null>;
  create(input: {
    purpose: UploadPurpose;
    contentType: UploadContentType;
    sizeBytes: number;
  }): Promise<CreatedUpload>;
  put(
    file: LocalFile,
    target: { url: string; headers: Record<string, string> },
    onProgress: (fraction: number) => void,
  ): Promise<void>;
  complete(id: string): Promise<unknown>;
  attach(uploadId: string): Promise<T>;
  now(): number;
}

export type UploadOutcome<T> =
  { ok: true; uploadId: string; result: T } | { ok: false; cancelled: boolean };

/** Reuse a presigned URL only with this much time left on it. */
const URL_MARGIN_MS = 30_000;

const WHAT_FAILED: Record<UploadStep, string> = {
  prepare: 'Faylni tayyorlab bo‘lmadi',
  request: 'Yuklashni boshlab bo‘lmadi',
  put: 'Fayl yuborilmadi',
  complete: 'Fayl tekshirilmadi',
  attach: 'Fayl saqlanmadi',
};

function describe(step: UploadStep, error: unknown): { message: string; retryable: boolean } {
  if (error instanceof UploadRefused) return { message: error.message, retryable: false };
  if (isApiError(error)) {
    if (error.status === 0) {
      return { message: `${WHAT_FAILED[step]}: internet aloqasini tekshiring`, retryable: true };
    }
    // the API explains 4xx (size, type, not configured); 5xx and 409 may pass
    const retryable = error.status >= 500 || error.status === 409 || error.status === 429;
    return { message: error.message, retryable: retryable || step !== 'request' };
  }
  if (error instanceof PutFailed) {
    return {
      message:
        error.status === 0
          ? 'Fayl yuborilmadi: internet aloqasini tekshiring'
          : `${WHAT_FAILED.put} (${error.status})`,
      retryable: true,
    };
  }
  return { message: WHAT_FAILED[step], retryable: true };
}

/**
 * Runs (or resumes) one upload: every state change goes to `onState`; `memo` is updated
 * as steps succeed. Never throws: a failure ends in a `failed` state saying which step.
 */
export async function runUpload<T>(
  deps: UploadDeps<T>,
  purpose: UploadPurpose,
  limits: PurposeLimits,
  memo: UploadMemo,
  onState: (state: UploadState) => void,
): Promise<UploadOutcome<T>> {
  let step: UploadStep = 'prepare';
  try {
    if (!memo.file) {
      onState({ status: 'preparing' });
      const file = await deps.prepare();
      if (!file) {
        onState({ status: 'idle' });
        return { ok: false, cancelled: true };
      }
      const problem = fileProblem(file, limits);
      if (problem) throw new UploadRefused(problem);
      memo.file = file;
    }
    const file = memo.file;

    if (!memo.completed) {
      if (memo.upload && !memo.put && memo.upload.expiresAt - deps.now() < URL_MARGIN_MS) {
        // the presigned URL ran out while the driver waited: ask for a new one
        memo.upload = undefined;
      }
      if (!memo.upload) {
        step = 'request';
        onState({ status: 'requesting' });
        const created = await deps.create({
          purpose,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
        });
        memo.upload = {
          id: created.id,
          url: created.upload.url,
          headers: created.upload.headers,
          expiresAt: deps.now() + created.upload.expiresInSeconds * 1000,
        };
        memo.put = false;
      }
      const upload = memo.upload;

      if (!memo.put) {
        step = 'put';
        onState({ status: 'uploading', progress: 0 });
        try {
          await deps.put(file, upload, (fraction) =>
            onState({ status: 'uploading', progress: Math.max(0, Math.min(1, fraction)) }),
          );
        } catch (error) {
          // a refused signature (expired, 403) needs a new URL next time
          if (error instanceof PutFailed && error.status >= 400 && error.status < 500) {
            memo.upload = undefined;
          }
          throw error;
        }
        memo.put = true;
      }

      step = 'complete';
      onState({ status: 'completing' });
      try {
        await deps.complete(upload.id);
      } catch (error) {
        if (isApiError(error, 409)) {
          // "not uploaded yet": the bytes did not land, send them again
          memo.put = false;
        } else if (isApiError(error, 400) || isApiError(error, 404)) {
          // the API deleted a file that did not match: start the upload over
          memo.upload = undefined;
          memo.put = false;
        }
        throw error;
      }
      memo.completed = true;
    }

    step = 'attach';
    const uploadId = memo.upload!.id;
    onState({ status: 'attaching' });
    const result = await deps.attach(uploadId);
    onState({ status: 'done', uploadId });
    return { ok: true, uploadId, result };
  } catch (error) {
    if (step === 'attach' && (isApiError(error, 404) || isApiError(error, 409))) {
      // the upload is gone or not ready (e.g. removed after a day): upload it again
      memo.upload = undefined;
      memo.put = false;
      memo.completed = false;
    }
    onState({ status: 'failed', step, ...describe(step, error) });
    return { ok: false, cancelled: false };
  }
}

/** Short Uzbek text for a state (the progress line under a document). */
export function uploadStateText(state: UploadState): string {
  switch (state.status) {
    case 'preparing':
      return 'Rasm tayyorlanmoqda…';
    case 'requesting':
      return 'Yuklash boshlanmoqda…';
    case 'uploading':
      return `Yuklanmoqda… ${Math.round(state.progress * 100)}%`;
    case 'completing':
      return 'Tekshirilmoqda…';
    case 'attaching':
      return 'Saqlanmoqda…';
    case 'done':
      return 'Yuklandi';
    case 'failed':
      return state.message;
    default:
      return '';
  }
}

/** Whether a state is in flight (buttons disabled, no second upload). */
export function isBusy(state: UploadState): boolean {
  return !['idle', 'done', 'failed'].includes(state.status);
}

/**
 * Whether an uploaded document is a PDF (shown as an icon, not an image): the API's
 * `contentType` says so; an unknown type is tried as an image (a broken one shows "Fayl").
 */
export function isPdfDocument(doc: { contentType?: string | null } | null | undefined): boolean {
  return (doc?.contentType ?? '').toLowerCase() === 'application/pdf';
}
