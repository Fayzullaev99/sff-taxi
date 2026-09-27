import * as DocumentPicker from 'expo-document-picker';
import { File, UploadType } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { Alert } from 'react-native';
import {
  contentTypeOf,
  IMAGE_PASSES,
  type LocalFile,
  PutFailed,
  resizeFor,
  UploadRefused,
  type UploadPurpose,
} from '../lib/upload-flow';

/** Where the file comes from: a fresh photo, the gallery, or a PDF scan (documents only). */
export type FileSource = 'camera' | 'gallery' | 'pdf';

interface Picked {
  uri: string;
  width: number;
  height: number;
  mime: string | null;
  name: string | null;
  size: number | null;
}

function askForSettings(what: string): void {
  Alert.alert(`${what} uchun ruxsat kerak`, 'Telefon sozlamalarida ruxsat bering.', [
    { text: 'Bekor qilish', style: 'cancel' },
    { text: 'Sozlamalarni ochish', onPress: () => void Linking.openSettings() },
  ]);
}

async function pick(source: FileSource, front: boolean): Promise<Picked | null> {
  if (source === 'pdf') {
    const r = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    const a = r.canceled ? null : r.assets[0];
    return a
      ? {
          uri: a.uri,
          width: 0,
          height: 0,
          mime: a.mimeType ?? null,
          name: a.name,
          size: a.size ?? null,
        }
      : null;
  }
  if (source === 'camera') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) {
      askForSettings('Kamera');
      return null;
    }
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // resized and compressed below; the picker only skips the original's full quality
    quality: 0.9,
    exif: false,
    ...(front ? { cameraType: ImagePicker.CameraType.front } : {}),
  };
  const r =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const a = r.canceled ? null : r.assets[0];
  return a
    ? {
        uri: a.uri,
        width: a.width,
        height: a.height,
        mime: a.mimeType ?? null,
        name: a.fileName ?? null,
        size: a.fileSize ?? null,
      }
    : null;
}

function sizeOf(uri: string, known: number | null): number {
  try {
    const size = new File(uri).size;
    if (typeof size === 'number' && size > 0) return size;
  } catch {
    // not readable through the file system: fall back to what the picker said
  }
  return known ?? 0;
}

/**
 * Picks a file and makes it fit the purpose's size limit: photos are resized (longest side
 * 1080–2000 px) and saved as JPEG, again smaller while still over the limit; a PDF is sent
 * as it is. Null when the driver cancelled.
 */
export async function pickAndPrepare(
  source: FileSource,
  purpose: UploadPurpose,
  maxBytes: number,
  front = false,
): Promise<LocalFile | null> {
  const picked = await pick(source, front);
  if (!picked) return null;
  const type = contentTypeOf(picked.mime, picked.name ?? picked.uri);
  if (type === 'application/pdf') {
    return { uri: picked.uri, contentType: type, sizeBytes: sizeOf(picked.uri, picked.size) };
  }
  if (!type && source === 'pdf') {
    throw new UploadRefused('Faqat PDF yoki rasm (JPEG, PNG, WebP) tanlang');
  }
  let last: LocalFile | null = null;
  for (const pass of IMAGE_PASSES[purpose]) {
    const context = ImageManipulator.ImageManipulator.manipulate(picked.uri);
    const resize = resizeFor(picked.width, picked.height, pass.maxSide);
    if (resize) context.resize(resize);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      compress: pass.quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    last = { uri: saved.uri, contentType: 'image/jpeg', sizeBytes: sizeOf(saved.uri, null) };
    if (last.sizeBytes > 0 && last.sizeBytes <= maxBytes) return last;
  }
  return last;
}

/**
 * PUTs the file to the presigned URL with the exact headers it was signed with, reporting
 * progress (0..1). Throws `PutFailed` with the storage's status (0: no answer).
 */
export async function putFile(
  file: LocalFile,
  target: { url: string; headers: Record<string, string> },
  onProgress: (fraction: number) => void,
): Promise<void> {
  const status = await new File(file.uri)
    .upload(target.url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: target.headers,
      mimeType: file.contentType,
      onProgress: ({ bytesSent, totalBytes }) =>
        onProgress(totalBytes > 0 ? bytesSent / totalBytes : 0),
    })
    .then(
      (result) => result.status,
      // no answer (offline, timeout, the file vanished from the cache)
      () => 0,
    );
  if (status < 200 || status >= 300) throw new PutFailed(status);
  onProgress(1);
}
