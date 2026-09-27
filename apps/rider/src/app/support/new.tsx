import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, describeError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { keys } from '../../api/queries';
import { useSupport } from '../../api/support';
import type { ComplaintType } from '../../api/types';
import {
  COMPLAINT_HINTS,
  COMPLAINT_TEXT_MAX,
  COMPLAINT_TEXT_MIN,
  COMPLAINT_TYPE_LABELS,
  COMPLAINT_TYPES,
} from '../../lib/complaints';
import { callPhone } from '../../lib/links';
import { PhotoAttach, useComplaintPhotos } from '../../ui/ComplaintPhotos';
import { Banner, Button, Chip, T, TextField } from '../../ui/primitives';
import { colors, space } from '../../ui/theme';

const isType = (v: string | undefined): v is ComplaintType =>
  (COMPLAINT_TYPES as readonly string[]).includes(v ?? '');

/**
 * A complaint about a ride, or a lost item: the type, what happened; operators answer in
 * the thread (Murojaatlarim). Accepted up to 7 days after the ride.
 */
export default function NewComplaintScreen() {
  const params = useLocalSearchParams<{ rideId?: string; number?: string; type?: string }>();
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
        <Banner
          tone="info"
          message="Murojaat safar bo‘yicha yoziladi: safarlar tarixidan safarni oching va “Muammo bo‘ldimi?” bo‘limini tanlang."
        />
        <Button title="Safarlar tarixi" onPress={() => router.replace('/history')} />
      </View>
    );
  }

  const length = text.trim().length;
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(8) }]}
        keyboardShouldPersistTaps="handled"
      >
        <T variant="h2" accessibilityRole="header">
          {params.number ? `Safar #${params.number}` : 'Safar bo‘yicha murojaat'}
        </T>
        <T variant="smallStrong" color={colors.textMuted}>
          Nima bo‘ldi?
        </T>
        <View style={styles.types} accessibilityRole="radiogroup">
          {COMPLAINT_TYPES.map((t) => (
            <Chip
              key={t}
              label={COMPLAINT_TYPE_LABELS[t]}
              icon={t === 'lost_item' ? 'bag-handle-outline' : undefined}
              selected={type === t}
              onPress={() => setType(t)}
            />
          ))}
        </View>
        {type === 'lost_item' ? (
          <Banner
            tone="info"
            message="Operator haydovchi bilan bog‘lanib, narsangizni qaytarishni kelishadi. Javob shu murojaatda keladi."
          />
        ) : null}
        {type === 'safety' && support.phone ? (
          <Banner
            tone="warning"
            message="Xavf hozir ham bo‘lsa, 112 ga yoki operatorga qo‘ng‘iroq qiling."
            action={
              <Button
                title="Operatorga qo‘ng‘iroq"
                size="sm"
                variant="dark"
                icon="call"
                onPress={() => void callPhone(support.phone!)}
              />
            }
          />
        ) : null}
        <TextField
          label="Batafsil"
          placeholder={type ? COMPLAINT_HINTS[type] : 'Avval yuqoridan turini tanlang'}
          value={text}
          onChangeText={(t) => {
            setError(null);
            setText(t);
          }}
          maxLength={COMPLAINT_TEXT_MAX}
          multiline
          hint={`${length}/${COMPLAINT_TEXT_MAX}`}
        />
        <PhotoAttach state={photos} />
        {error ? <Banner tone="danger" message={error} /> : null}
        <Button
          title={photos.settled ? 'Yuborish' : 'Rasm yuborilmoqda…'}
          size="lg"
          icon="send"
          loading={busy}
          disabled={!type || length < COMPLAINT_TEXT_MIN || !photos.settled}
          onPress={() => void submit()}
        />
        <T variant="small" color={colors.textMuted}>
          Murojaat safardan keyin 7 kun ichida qabul qilinadi. Javobni “Murojaatlarim” bo‘limida
          ko‘rasiz.
        </T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, padding: space(4), gap: space(3), justifyContent: 'center' },
  content: { padding: space(4), gap: space(3) },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
});
