import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { driver } from '../api/driver';
import type { DriverDocument, DriverMe } from '../api/types';
import { keys, useDriverMe, useUploadsConfig } from '../data/queries';
import { useT } from '../i18n';
import { DOCUMENTS, parseDate, showDate, tashkentToday } from '../lib/application';
import { dateInput, dateTime } from '../lib/format';
import { isPdfDocument, type UploadPurpose } from '../lib/upload-flow';
import type { FileSource } from '../uploads/files';
import { useUpload } from '../uploads/use-upload';
import { Banner, Button, Card, Chip, Field, Loading, Muted, SectionTitle } from '../ui/components';
import { haptics } from '../ui/haptics';
import { Screen } from '../ui/screen';
import { colors, radius, space } from '../ui/theme';
import { UploadButtons } from '../ui/upload';

/**
 * The document photos operators check before approval, and the two photos riders see (the
 * driver's face and the car). Each is taken with the camera (or picked from the gallery, or
 * a PDF scan for documents), shrunk to the size limit, uploaded straight to the private
 * bucket with progress, checked by the API and attached — a failed step can be retried
 * without taking the photo again.
 */
export default function Documents() {
  const { t } = useT();
  const router = useRouter();
  const me = useDriverMe();
  const uploads = useUploadsConfig();
  if (!me.data) return <Loading />;
  const d = me.data;
  const have = new Map(d.documents.map((x) => [x.kind, x]));
  const missing = d.missingDocuments.length;

  return (
    <Screen
      keyboard
      title={t('common.screens.documents')}
      refreshing={me.isRefetching}
      onRefresh={() => void me.refetch()}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      footer={
        d.status !== 'active' ? (
          <Button
            title={
              missing
                ? t('apply.documents.needMore', { count: missing })
                : t('apply.documents.allUploadedSeeStatus')
            }
            icon={missing ? 'document-attach' : 'checkmark'}
            big
            disabled={missing > 0}
            onPress={() => router.replace('/status')}
          />
        ) : null
      }
    >
      {!uploads.enabled ? (
        <Banner
          tone="warning"
          icon="cloud-offline"
          title={t('apply.documents.uploadsOffTitle')}
          text={t('apply.documents.uploadsOffText')}
        />
      ) : (
        <Muted>{t('apply.documents.tips')}</Muted>
      )}

      <SectionTitle>{t('apply.documents.ridersSee')}</SectionTitle>
      <PhotoCard
        title={t('apply.documents.yourPhoto')}
        hint={t('apply.documents.yourPhotoHint')}
        purpose="profile_photo"
        url={d.photoUrl ?? null}
        front
        attach={driver.setPhoto}
      />
      {d.vehicle ? (
        <PhotoCard
          title={t('apply.documents.carPhoto')}
          hint={t('apply.documents.carPhotoHint')}
          purpose="vehicle_photo"
          url={d.vehicle.photoUrl ?? null}
          attach={driver.setVehiclePhoto}
        />
      ) : null}

      <SectionTitle>
        {t('apply.documents.sectionCount', {
          have: DOCUMENTS.length - missing,
          total: DOCUMENTS.length,
        })}
      </SectionTitle>
      {DOCUMENTS.map((doc) => (
        <DocumentCard key={doc.kind} doc={doc} current={have.get(doc.kind) ?? null} />
      ))}
    </Screen>
  );
}

/** A photo, or a file icon for a PDF (`pdf`: from the document's `contentType`). */
function Thumb(props: { url: string | null | undefined; round?: boolean; pdf?: boolean }) {
  const { t } = useT();
  const [broken, setBroken] = useState(false);
  if (!props.url) return null;
  if (props.pdf || broken) {
    return (
      <View style={[styles.thumb, styles.thumbIcon]}>
        <Ionicons name="document-text" size={36} color={colors.muted} />
        <Text style={styles.thumbText}>{broken ? t('apply.documents.file') : 'PDF'}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: props.url }}
      style={[styles.thumb, props.round && { borderRadius: 32 }]}
      resizeMode="cover"
      onError={() => setBroken(true)}
      accessibilityIgnoresInvertColors
    />
  );
}

/** The driver's photo or the car's photo (riders see them on the ride screen). */
function PhotoCard(props: {
  title: string;
  hint: string;
  purpose: Extract<UploadPurpose, 'profile_photo' | 'vehicle_photo'>;
  url: string | null;
  front?: boolean;
  attach: (uploadId: string) => Promise<DriverMe>;
}) {
  const { t } = useT();
  const qc = useQueryClient();
  const upload = useUpload(props.purpose, async (id) => {
    const next = await props.attach(id);
    qc.setQueryData(keys.me, next);
    haptics.success();
    return next;
  });
  const [open, setOpen] = useState(false);
  const show = open || !props.url || upload.state.status !== 'idle';
  const done = upload.state.status === 'done';

  return (
    <Card>
      <View style={styles.head}>
        {props.url ? (
          <Thumb url={props.url} round={props.purpose === 'profile_photo'} />
        ) : (
          <Ionicons
            name={props.purpose === 'profile_photo' ? 'person-circle-outline' : 'car-outline'}
            size={40}
            color={colors.muted}
          />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name}>{props.title}</Text>
          <Muted>{props.hint}</Muted>
        </View>
        {props.url ? (
          <Chip label={t('apply.documents.have')} tone="success" />
        ) : (
          <Chip label={t('apply.documents.needed')} tone="warning" />
        )}
      </View>
      {show && !done && upload.enabled ? (
        <UploadButtons
          state={upload.state}
          busy={upload.busy}
          maxBytes={upload.limits.maxBytes}
          cameraTitle={props.front ? t('apply.upload.takeSelfie') : t('apply.upload.takePhoto')}
          onPick={(source: FileSource) => void upload.start(source, props.front)}
          onRetry={() => void upload.retry()}
        />
      ) : props.url ? (
        <Button
          title={t('apply.documents.newPhoto')}
          icon="camera-reverse"
          variant="secondary"
          disabled={!upload.enabled}
          onPress={() => {
            upload.reset();
            setOpen(true);
          }}
        />
      ) : null}
    </Card>
  );
}

function DocumentCard(props: { doc: (typeof DOCUMENTS)[number]; current: DriverDocument | null }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(!props.current);
  const [expires, setExpires] = useState(showDate(props.current?.expiresOn));
  const [problem, setProblem] = useState<string | null>(null);

  const upload = useUpload('document', async (uploadId) => {
    const expiresOn = props.doc.expires && expires.trim() ? parseDate(expires) : null;
    const next = await driver.setDocument(props.doc.kind, uploadId, expiresOn);
    qc.setQueryData(keys.me, next);
    haptics.success();
    setOpen(false);
    return next;
  });

  const pick = (source: FileSource) => {
    if (props.doc.expires && expires.trim()) {
      const d = parseDate(expires);
      if (!d) return setProblem(t('apply.documents.expiryFormat'));
      if (d < tashkentToday()) return setProblem(t('apply.documents.expiredUploadNew'));
    }
    setProblem(null);
    void upload.start(source, props.doc.kind === 'selfie');
  };

  const expired = !!props.current?.expiresOn && props.current.expiresOn < tashkentToday();

  return (
    <Card>
      <View style={styles.head}>
        {props.current?.url ? (
          <Thumb url={props.current.url} pdf={isPdfDocument(props.current)} />
        ) : (
          <Ionicons
            name={props.current ? 'checkmark-circle' : 'ellipse-outline'}
            size={28}
            color={props.current ? colors.success : colors.muted}
          />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name}>{props.doc.label}</Text>
          <Muted>{props.doc.hint}</Muted>
        </View>
        {expired ? (
          <Chip label={t('apply.documents.expired')} tone="danger" />
        ) : props.current ? (
          <Chip label={t('apply.documents.uploaded')} tone="success" />
        ) : (
          <Chip label={t('apply.documents.needed')} tone="warning" />
        )}
      </View>
      {props.current && !open ? (
        <>
          <Muted>
            {props.current.expiresOn
              ? t('apply.documents.uploadedValidUntil', {
                  uploaded: dateTime(props.current.uploadedAt),
                  date: showDate(props.current.expiresOn),
                })
              : dateTime(props.current.uploadedAt)}
          </Muted>
          <Button
            title={t('apply.documents.replace')}
            icon="swap-horizontal"
            variant="secondary"
            disabled={!upload.enabled}
            onPress={() => {
              upload.reset();
              setOpen(true);
            }}
          />
        </>
      ) : upload.enabled ? (
        <View style={{ gap: space.sm }}>
          {props.doc.expires ? (
            <Field
              label={t('apply.documents.expiryLabel')}
              value={expires}
              onChangeText={(v) => setExpires(dateInput(v))}
              keyboardType="number-pad"
              placeholder={t('apply.form.datePlaceholder')}
              maxLength={10}
              editable={!upload.busy}
              error={problem}
            />
          ) : problem ? (
            <Text style={styles.error}>{problem}</Text>
          ) : null}
          <UploadButtons
            state={upload.state}
            busy={upload.busy}
            allowPdf
            maxBytes={upload.limits.maxBytes}
            cameraTitle={
              props.doc.kind === 'selfie'
                ? t('apply.upload.takeSelfie')
                : t('apply.upload.takePhoto')
            }
            onPick={pick}
            onRetry={() => void upload.retry()}
          />
          {props.current ? (
            <Button
              title={t('common.actions.cancel')}
              variant="ghost"
              disabled={upload.busy}
              onPress={() => setOpen(false)}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: 17, fontWeight: '800', color: colors.text },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  thumbIcon: { alignItems: 'center', justifyContent: 'center' },
  thumbText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
});
