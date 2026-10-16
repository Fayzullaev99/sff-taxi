import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../i18n';
import { megabytes, type UploadState, uploadStateText } from '../lib/upload-flow';
import type { FileSource } from '../uploads/files';
import { Button } from './components';
import { colors, radius, space } from './theme';

/** The progress line under an upload: a bar while sending, the message when it failed. */
export function UploadProgress(props: { state: UploadState }) {
  const s = props.state;
  if (s.status === 'idle' || s.status === 'done') return null;
  const failed = s.status === 'failed';
  const fraction =
    s.status === 'uploading'
      ? s.progress
      : s.status === 'completing' || s.status === 'attaching'
        ? 1
        : 0;
  return (
    <View style={{ gap: space.xs }} accessibilityLiveRegion="polite">
      {!failed ? (
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
        >
          <View style={[styles.bar, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
      ) : null}
      <Text style={[styles.text, failed && { color: colors.danger }]}>{uploadStateText(s)}</Text>
    </View>
  );
}

/**
 * Where to take the file from: camera (the usual way, big), gallery, and a PDF scan for
 * documents. While a failed upload can be continued, "Qayta urinish" comes first.
 */
export function UploadButtons(props: {
  state: UploadState;
  busy: boolean;
  allowPdf?: boolean;
  maxBytes: number;
  cameraTitle?: string;
  onPick: (source: FileSource) => void;
  onRetry: () => void;
}) {
  const { t } = useT();
  const s = props.state;
  const canRetry = s.status === 'failed' && s.retryable && s.step !== 'prepare';
  return (
    <View style={{ gap: space.sm }}>
      <UploadProgress state={s} />
      {canRetry ? (
        <Button title={t('common.actions.retry')} icon="refresh" onPress={props.onRetry} />
      ) : null}
      <Button
        title={props.cameraTitle ?? t('apply.upload.takePhoto')}
        icon="camera"
        variant={canRetry ? 'secondary' : 'primary'}
        loading={props.busy}
        onPress={() => props.onPick('camera')}
      />
      <View style={styles.pair}>
        <Button
          title={t('apply.upload.gallery')}
          icon="images"
          variant="secondary"
          disabled={props.busy}
          onPress={() => props.onPick('gallery')}
          style={{ flex: 1 }}
        />
        {props.allowPdf ? (
          <Button
            title={t('apply.upload.pdf')}
            icon="document"
            variant="secondary"
            disabled={props.busy}
            onPress={() => props.onPick('pdf')}
            style={{ flex: 1 }}
          />
        ) : null}
      </View>
      <Text style={styles.hint}>
        {t(props.allowPdf ? 'apply.upload.hintWithPdf' : 'apply.upload.hintImages', {
          mb: megabytes(props.maxBytes),
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  bar: { height: 10, borderRadius: radius.pill, backgroundColor: colors.brand },
  text: { color: colors.text, fontSize: 15, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 13 },
  pair: { flexDirection: 'row', gap: space.sm },
});
