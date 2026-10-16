import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, describeError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { keys } from '../../api/queries';
import { useSupport } from '../../api/support';
import type { ComplaintType } from '../../api/types';
import { useT } from '../../i18n';
import {
  complaintHint,
  COMPLAINT_TEXT_MAX,
  COMPLAINT_TEXT_MIN,
  complaintTypeLabel,
  COMPLAINT_TYPES,
} from '../../lib/complaints';
import { callPhone } from '../../lib/links';
import { PhotoAttach, useComplaintPhotos } from '../../ui/ComplaintPhotos';
import { Banner, Button, Chip, T, TextField } from '../../ui/primitives';
import { colors, space } from '../../ui/theme';
import { KeyboardAvoider } from '../../ui/KeyboardAvoider';

const isType = (v: string | undefined): v is ComplaintType =>
  (COMPLAINT_TYPES as readonly string[]).includes(v ?? '');

/**
 * A complaint about a ride, or a lost item: the type, what happened; operators answer in
 * the thread (Murojaatlarim). Accepted up to 7 days after the ride.
 */
export default function NewComplaintScreen() {
  const params = useLocalSearchParams<{ rideId?: string; number?: string; type?: string }>();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const support = useSupport();
  const [type, setType] = useState<ComplaintType | null>(isType(params.type) ? params.type : null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rideId = params.rideId;
  const photos = useComplaintPhotos();

  const submit = async () => {
    if (!rideId || !type) return;
    setBusy(true);
    setError(null);
    try {
      const complaint = await endpoints.complain(rideId, type, text.trim(), photos.uploadIds);
      queryClient.setQueryData(keys.complaint(complaint.id), complaint);
      void queryClient.invalidateQueries({ queryKey: keys.complaints });
      router.replace({ pathname: '/support/[id]', params: { id: complaint.id } });
    } catch (e) {
      // an open complaint of this type exists already: the list has it
      if (e instanceof ApiError && e.status === 409) {
        void queryClient.invalidateQueries({ queryKey: keys.complaints });
      }
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!rideId) {
    return (
      <View style={styles.center}>
        <Banner tone="info" message={t('support.new.needRide')} />
        <Button title={t('common.screens.history')} onPress={() => router.replace('/history')} />
      </View>
    );
  }

  const length = text.trim().length;
  return (
    <KeyboardAvoider style={styles.root} keyboardVerticalOffset={90}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(8) }]}
        keyboardShouldPersistTaps="handled"
      >
        <T variant="h2" accessibilityRole="header">
          {params.number
            ? t('support.rideNumber', { number: params.number })
            : t('support.new.title')}
        </T>
        <T variant="smallStrong" color={colors.textMuted}>
          {t('support.new.whatHappened')}
        </T>
        <View style={styles.types} accessibilityRole="radiogroup">
          {COMPLAINT_TYPES.map((kind) => (
            <Chip
              key={kind}
              label={complaintTypeLabel(kind)}
              icon={kind === 'lost_item' ? 'bag-handle-outline' : undefined}
              selected={type === kind}
              onPress={() => setType(kind)}
            />
          ))}
        </View>
        {type === 'lost_item' ? (
          <Banner tone="info" message={t('support.new.lostItemNote')} />
        ) : null}
        {type === 'safety' && support.phone ? (
          <Banner
            tone="warning"
            message={t('support.new.safetyNote')}
            action={
              <Button
                title={t('support.new.callOperator')}
                size="sm"
                variant="dark"
                icon="call"
                onPress={() => void callPhone(support.phone!)}
              />
            }
          />
        ) : null}
        <TextField
          label={t('support.new.details')}
          placeholder={type ? complaintHint(type) : t('support.new.pickTypeFirst')}
          value={text}
          onChangeText={(value) => {
            setError(null);
            setText(value);
          }}
          maxLength={COMPLAINT_TEXT_MAX}
          multiline
          hint={`${length}/${COMPLAINT_TEXT_MAX}`}
        />
        <PhotoAttach state={photos} />
        {error ? <Banner tone="danger" message={error} /> : null}
        <Button
          title={photos.settled ? t('common.actions.send') : t('support.photos.sending')}
          size="lg"
          icon="send"
          loading={busy}
          disabled={!type || length < COMPLAINT_TEXT_MIN || !photos.settled}
          onPress={() => void submit()}
        />
        <T variant="small" color={colors.textMuted}>
          {t('support.new.windowNote')}
        </T>
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, padding: space(4), gap: space(3), justifyContent: 'center' },
  content: { padding: space(4), gap: space(3) },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
});
