import type { UploadContentType, UploadPurpose } from '../../core/db/schema.js';

/** Accepted types and their file extensions. */
export const FILE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const satisfies Record<UploadContentType, string>;

/** What each purpose accepts: photos are images, a scanned document may be a PDF. */
export const PURPOSE_TYPES: Record<UploadPurpose, readonly UploadContentType[]> = {
  document: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  profile_photo: ['image/jpeg', 'image/png', 'image/webp'],
  vehicle_photo: ['image/jpeg', 'image/png', 'image/webp'],
};

/** Phone photos of a document are 2-6 MB; PDFs of scans similar. */
export const MAX_BYTES: Record<UploadPurpose, number> = {
  document: 10 * 1024 * 1024,
  profile_photo: 5 * 1024 * 1024,
  vehicle_photo: 5 * 1024 * 1024,
};

/** Bytes needed to recognise every accepted type. */
export const SIGNATURE_LENGTH = 12;

/**
 * The real type from the file's leading bytes, so a declared "image/png" that is actually
 * HTML, a script or an executable is refused.
 */
export function detectFileType(head: Uint8Array): UploadContentType | null {
  const starts = (bytes: number[], offset = 0) => bytes.every((b, i) => head[offset + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // "RIFF" <size> "WEBP"
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  // "%PDF-"
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

/** u/<owner>/<purpose>/<random>.<ext>: grouped per user, unguessable, never reused. */
export function objectKey(
  ownerId: string,
  purpose: UploadPurpose,
  random: string,
  type: UploadContentType,
): string {
  return `u/${ownerId}/${purpose.replace('_', '-')}/${random}.${FILE_TYPES[type]}`;
}
