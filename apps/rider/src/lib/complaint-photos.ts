/**
 * Photos on a complaint (pure, unit-tested): a lost bag, a dirty seat. Each photo is sent
 * as an upload (purpose `complaint_photo`: POST /uploads, PUT to the presigned URL,
 * complete) and the complaint or a reply carries the ready ids (`photoUploadIds`). The API
 * takes at most three per complaint, JPEG / PNG / WebP up to 5 MB.
 */

export const MAX_COMPLAINT_PHOTOS = 3;
/** The API's limit for complaint photos (GET /uploads/config says it too). */
export const COMPLAINT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * How a phone photo is made small enough: the longest side and the JPEG quality per pass,
 * a smaller pass while the file is still over the limit. Enough to read a label or see a
 * stain; small enough for a slow mobile connection.
 */
export const PHOTO_PASSES: readonly { maxSide: number; quality: number }[] = [
  { maxSide: 1600, quality: 0.7 },
  { maxSide: 1280, quality: 0.6 },
  { maxSide: 1024, quality: 0.5 },
];

/** The resize for a pass: the longest side down to `maxSide`, never up; null to keep it. */
export function resizeFor(
  width: number,
  height: number,
  maxSide: number,
): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (Math.max(width, height) <= maxSide) return null;
  return width >= height ? { width: maxSide } : { height: maxSide };
}

export type PhotoStatus = 'uploading' | 'ready' | 'failed';

/** A photo the rider added to the form, while and after it is sent. */
export interface AttachedPhoto {
  /** Local id (the list key). */
  key: string;
  /** The prepared local file (for the thumbnail and a retry). */
  uri: string;
  status: PhotoStatus;
  /** Set once the upload is complete (ready to attach). */
  uploadId: string | null;
  error: string | null;
}

/** How many more photos the rider may add: the complaint's own plus this form's count. */
export function photosLeft(alreadyOnComplaint: number, attached: readonly AttachedPhoto[]): number {
  return Math.max(0, MAX_COMPLAINT_PHOTOS - alreadyOnComplaint - attached.length);
}

/** The ids to send: only photos whose upload is complete. */
export function readyUploadIds(attached: readonly AttachedPhoto[]): string[] {
  return attached.flatMap((p) => (p.status === 'ready' && p.uploadId ? [p.uploadId] : []));
}

/**
 * Whether the form can be sent: nothing still uploading (it would go without it) and no
 * failed photo left (retry or remove it first, so nothing is lost silently).
 */
export function photosSettled(attached: readonly AttachedPhoto[]): boolean {
  return attached.every((p) => p.status === 'ready');
}

/** Replaces one photo's state by key (immutably). */
export function updatePhoto(
  list: readonly AttachedPhoto[],
  key: string,
  patch: Partial<Omit<AttachedPhoto, 'key'>>,
): AttachedPhoto[] {
  return list.map((p) => (p.key === key ? { ...p, ...patch } : p));
}

/** A line under the photo buttons. */
export function photoHint(left: number, uploadsOn: boolean): string {
  if (!uploadsOn) return 'Rasm yuklash hozircha ishlamayapti — vaziyatni matnda yozing.';
  if (left <= 0) return `Bitta murojaatga ko‘pi bilan ${MAX_COMPLAINT_PHOTOS} ta rasm.`;
  return `Rasm qo‘shishingiz mumkin (yana ${left} ta): masalan, qolgan narsa yoki mashina holati.`;
}
