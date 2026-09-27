/**
 * A complaint photo from the camera or the gallery to a ready upload: pick → make it small
 * (JPEG, longest side 1600 px, smaller while over 5 MB) → POST /uploads (purpose
 * `complaint_photo`) → PUT the bytes to the presigned URL with the signed headers →
 * complete. The same steps as the driver app's documents, without their resumable state:
 * a failed photo is simply sent again from its prepared file.
 */
import { File, UploadType } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';
import { endpoints } from '../api/endpoints';
import { confirm } from '../lib/dialogs';
import { COMPLAINT_PHOTO_MAX_BYTES, PHOTO_PASSES, resizeFor } from '../lib/complaint-photos';

export type PhotoSource = 'camera' | 'gallery';

export interface PreparedPhoto {
  uri: string;
  sizeBytes: number;
}

/** Why a photo could not be sent, in the rider's words. */
export class PhotoError extends Error {}

function sizeOf(uri: string): number {
  try {
    const size = new File(uri).size;
    return typeof size === 'number' && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

async function permitted(source: PhotoSource): Promise<boolean> {
  // the gallery goes through the system photo picker: no permission (storage is blocked)
  if (source === 'gallery') return true;
  const p = await ImagePicker.requestCameraPermissionsAsync();
  if (p.granted) return true;
  const open = await confirm({
    title: 'Kameraga ruxsat kerak',
    message: 'Telefon sozlamalarida SFF Taxi’ga ruxsat bering.',
    confirmText: 'Sozlamalarni ochish',
  });
  if (open) await Linking.openSettings().catch(() => undefined);
  return false;
}

/** Picks a photo and prepares it (null when the rider cancelled). */
export async function pickPhoto(source: PhotoSource): Promise<PreparedPhoto | null> {
  if (!(await permitted(source))) return null;
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // resized and compressed below
    quality: 0.9,
    exif: false,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  let last: PreparedPhoto | null = null;
  for (const pass of PHOTO_PASSES) {
    const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
    const resize = resizeFor(asset.width, asset.height, pass.maxSide);
    if (resize) context.resize(resize);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      compress: pass.quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    last = { uri: saved.uri, sizeBytes: sizeOf(saved.uri) };
    if (last.sizeBytes > 0 && last.sizeBytes <= COMPLAINT_PHOTO_MAX_BYTES) return last;
  }
  if (!last || last.sizeBytes <= 0) throw new PhotoError('Rasmni o‘qib bo‘lmadi');
  throw new PhotoError('Rasm juda katta (5 MB dan oshmasin)');
}

/** Sends a prepared photo and returns the ready upload's id. */
export async function uploadPhoto(photo: PreparedPhoto): Promise<string> {
  const created = await endpoints.createUpload({
    purpose: 'complaint_photo',
    contentType: 'image/jpeg',
    sizeBytes: photo.sizeBytes,
  });
  const status = await new File(photo.uri)
    .upload(created.upload.url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: created.upload.headers,
      mimeType: 'image/jpeg',
    })
    .then(
      (r) => r.status,
      // no answer (offline, timeout)
      () => 0,
    );
  if (status < 200 || status >= 300) {
    throw new PhotoError(
      status === 0 ? 'Aloqa yo‘q: rasm yuborilmadi' : 'Rasm yuborilmadi, qayta urinib ko‘ring',
    );
  }
  const done = await endpoints.completeUpload(created.id);
  return done.id;
}
