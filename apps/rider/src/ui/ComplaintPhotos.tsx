import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../api/client';
import { useAppConfig } from '../api/queries';
import {
  type AttachedPhoto,
  photoHint,
  photosLeft,
  photosSettled,
  readyUploadIds,
  updatePhoto,
} from '../lib/complaint-photos';
import {
  PhotoError,
  type PhotoSource,
  pickPhoto,
  type PreparedPhoto,
  uploadPhoto,
} from '../uploads/complaint-photo';
import { Button, Icon, IconButton, T } from './primitives';
import { colors, radius, space } from './theme';

const errorText = (e: unknown) => (e instanceof PhotoError ? e.message : describeError(e));

/**
 * Photos being added to a complaint or a reply: each one is sent as soon as it is picked,
 * so the form only waits for the last one. `existing`: photos the complaint already has.
 */
export function useComplaintPhotos(existing = 0) {
  const uploadsOn = useAppConfig().data?.features.uploads !== false;
  const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
  const files = useRef(new Map<string, PreparedPhoto>());
  const counter = useRef(0);

  const send = useCallback(async (key: string) => {
    const file = files.current.get(key);
    if (!file) return;
    setPhotos((list) => updatePhoto(list, key, { status: 'uploading', error: null }));
    try {
      const uploadId = await uploadPhoto(file);
      setPhotos((list) => updatePhoto(list, key, { status: 'ready', uploadId }));
    } catch (e) {
      setPhotos((list) => updatePhoto(list, key, { status: 'failed', error: errorText(e) }));
    }
  }, []);

  const addFrom = useCallback(
    async (source: PhotoSource) => {
      try {
        const file = await pickPhoto(source);
        if (!file) return;
        const key = `p${++counter.current}`;
        files.current.set(key, file);
        setPhotos((list) => [
          ...list,
          { key, uri: file.uri, status: 'uploading', uploadId: null, error: null },
        ]);
        void send(key);
      } catch (e) {
        Alert.alert('Rasm qo‘shilmadi', errorText(e));
      }
    },
    [send],
  );

  const add = useCallback(() => {
    Alert.alert('Rasm qo‘shish', undefined, [
      { text: 'Kamera', onPress: () => void addFrom('camera') },
      { text: 'Galereya', onPress: () => void addFrom('gallery') },
      { text: 'Bekor qilish', style: 'cancel' },
    ]);
  }, [addFrom]);

  const remove = useCallback((key: string) => {
    files.current.delete(key);
    setPhotos((list) => list.filter((p) => p.key !== key));
  }, []);

  const reset = useCallback(() => {
    files.current.clear();
    setPhotos([]);
  }, []);

  const left = photosLeft(existing, photos);
  return {
    photos,
    uploadsOn,
    left,
    settled: photosSettled(photos),
    uploadIds: readyUploadIds(photos),
    add,
    retry: (key: string) => void send(key),
    remove,
    reset,
  };
}

export type ComplaintPhotosState = ReturnType<typeof useComplaintPhotos>;

/** Thumbnails of the photos being added (sending, sent, failed) and the add button. */
export function PhotoAttach({
  state,
  compact = false,
}: {
  state: ComplaintPhotosState;
  compact?: boolean;
}) {
  const { photos, left, uploadsOn } = state;
  if (!uploadsOn && !photos.length) {
    return compact ? null : (
      <T variant="small" color={colors.textMuted}>
        {photoHint(0, false)}
      </T>
    );
  }
  return (
    <View style={styles.attach}>
      {photos.length ? (
        <View style={styles.thumbs}>
          {photos.map((p) => (
            <View key={p.key} style={styles.thumbBox}>
              <Image
                source={{ uri: p.uri }}
                style={styles.thumb}
                accessibilityIgnoresInvertColors
              />
              {p.status === 'uploading' ? (
                <View style={styles.overlay} accessibilityLabel="Rasm yuborilmoqda">
                  <ActivityIndicator color={colors.bg} />
                </View>
              ) : null}
              {p.status === 'failed' ? (
                <Pressable
                  style={[styles.overlay, styles.failed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Rasm yuborilmadi: ${p.error ?? ''}. Qayta urinish`}
                  onPress={() => state.retry(p.key)}
                >
                  <Icon name="refresh" size={22} color={colors.bg} />
                  <T variant="caption" color={colors.bg} align="center">
                    Qayta
                  </T>
                </Pressable>
              ) : null}
              <IconButton
                name="close"
                label="Rasmni olib tashlash"
                size={28}
                background={colors.ink}
                color={colors.bg}
                onPress={() => state.remove(p.key)}
                style={styles.removeBtn}
              />
            </View>
          ))}
        </View>
      ) : null}
      {uploadsOn && left > 0 ? (
        <Button
          title={compact ? 'Rasm' : 'Rasm qo‘shish'}
          icon="camera-outline"
          variant="secondary"
          size="sm"
          onPress={state.add}
          accessibilityLabel={`Rasm qo‘shish, yana ${left} ta mumkin`}
        />
      ) : null}
      {!compact ? (
        <T variant="small" color={colors.textMuted}>
          {photoHint(left, uploadsOn)}
        </T>
      ) : null}
    </View>
  );
}

/** Photos already on a complaint: thumbnails, a tap shows one full screen. */
export function PhotoStrip({ photos }: { photos: { uploadId: string; url: string | null }[] }) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<string | null>(null);
  const shown = photos.filter((p): p is { uploadId: string; url: string } => Boolean(p.url));
  if (!shown.length) return null;
  return (
    <>
      <ScrollView horizontal contentContainerStyle={styles.thumbs} style={styles.strip}>
        {shown.map((p, i) => (
          <Pressable
            key={p.uploadId}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${i + 1}-rasm, kattalashtirish`}
            onPress={() => setOpen(p.url)}
          >
            <Image source={{ uri: p.url }} style={styles.thumb} accessibilityIgnoresInvertColors />
          </Pressable>
        ))}
      </ScrollView>
      <Modal visible={open !== null} transparent onRequestClose={() => setOpen(null)}>
        <View style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          {open ? (
            <Image
              source={{ uri: open }}
              style={styles.full}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          ) : null}
          <IconButton
            name="close"
            label="Yopish"
            size={48}
            onPress={() => setOpen(null)}
            style={[styles.close, { top: insets.top + space(3) }]}
          />
        </View>
      </Modal>
    </>
  );
}

const THUMB = 76;

const styles = StyleSheet.create({
  attach: { gap: space(2) },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2.5) },
  strip: { flexGrow: 0 },
  thumbBox: { width: THUMB, height: THUMB },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.md, backgroundColor: colors.surface },
  overlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.md,
    backgroundColor: 'rgba(17,17,17,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  failed: { backgroundColor: 'rgba(180,35,24,0.8)' },
  removeBtn: { position: 'absolute', top: -8, right: -8 },
  viewer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  close: { position: 'absolute', right: space(4) },
});
