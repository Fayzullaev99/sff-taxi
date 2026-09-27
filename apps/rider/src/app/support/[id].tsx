import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { keys, useComplaint } from '../../api/queries';
import { useLiveRides } from '../../api/realtime';
import type { ComplaintMessage } from '../../api/types';
import { COMPLAINT_STATUS_LABELS, RESOLUTION_LABELS } from '../../lib/complaints';
import { formatDateTime } from '../../lib/format';
import { PhotoAttach, PhotoStrip, useComplaintPhotos } from '../../ui/ComplaintPhotos';
import { Banner, Button, Card, IconButton, T, TextField } from '../../ui/primitives';
import { ErrorView, LoadingView } from '../../ui/states';
import { colors, radius, space } from '../../ui/theme';

/** One complaint: what the rider wrote, the thread with the operators, the outcome. */
export default function ComplaintScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useLiveRides();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useComplaint(id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = query.data;
  const photos = useComplaintPhotos(c?.photos?.length ?? 0);
  const canSend = Boolean(text.trim()) && photos.settled && !busy;

  const send = async () => {
    if (!c || !canSend) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await endpoints.replyComplaint(c.id, text.trim(), photos.uploadIds);
      queryClient.setQueryData(keys.complaint(c.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.complaints });
      setText('');
      photos.reset();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!c) {
    return query.isError ? (
      <ErrorView error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <LoadingView />
    );
  }

  const resolved = c.status === 'resolved';
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(6) }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.head}>
          <T variant="h2" accessibilityRole="header">
            {c.typeLabel}
          </T>
          <T variant="small" color={colors.textMuted}>
            {formatDateTime(c.createdAt)} ·{' '}
            <T
              variant="small"
              color={colors.brandText}
              onPress={() => router.push({ pathname: '/ride/[id]', params: { id: c.rideId } })}
              accessibilityRole="link"
            >
              safar #{c.rideNumber}
            </T>
          </T>
          <T variant="smallStrong" color={resolved ? colors.success : colors.info}>
            {COMPLAINT_STATUS_LABELS[c.status]}
          </T>
        </View>

        {resolved ? (
          <Banner
            tone="success"
            title={c.resolution ? RESOLUTION_LABELS[c.resolution] : 'Murojaat yopildi'}
            message={c.resolutionNote ?? undefined}
          />
        ) : null}

        <Bubble mine text={c.text} at={c.createdAt} />
        {c.photos?.length ? <PhotoStrip photos={c.photos} /> : null}
        {c.messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {!c.messages.some((m) => m.authorRole === 'admin') && !resolved ? (
          <T variant="small" color={colors.textMuted} align="center">
            Operator ko‘rib chiqib, shu yerda javob beradi.
          </T>
        ) : null}

        {!resolved ? (
          <Card style={styles.reply}>
            <TextField
              placeholder="Qo‘shimcha yozing…"
              value={text}
              onChangeText={(t) => {
                setError(null);
                setText(t);
              }}
              maxLength={2000}
              multiline
              accessibilityLabel="Javob"
              style={styles.flex}
            />
            <IconButton
              name="send"
              label="Yuborish"
              size={46}
              background={canSend ? colors.brand : colors.surface}
              color={colors.ink}
              onPress={canSend ? () => void send() : undefined}
            />
          </Card>
        ) : null}
        {!resolved ? <PhotoAttach state={photos} compact /> : null}
        {error ? <Banner tone="danger" message={error} /> : null}
        {busy ? (
          <T variant="small" color={colors.textMuted}>
            Yuborilmoqda…
          </T>
        ) : null}
        <Button
          title="Barcha murojaatlar"
          variant="ghost"
          onPress={() => router.replace('/support')}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Message({ message }: { message: ComplaintMessage }) {
  return <Bubble mine={message.authorRole === 'rider'} text={message.text} at={message.at} />;
}

function Bubble({ mine, text, at }: { mine: boolean; text: string; at: string }) {
  return (
    <View
      style={[styles.bubble, mine ? styles.mine : styles.theirs]}
      accessible
      accessibilityLabel={`${mine ? 'Siz' : 'Operator'}: ${text}. ${formatDateTime(at)}`}
    >
      {!mine ? (
        <T variant="caption" color={colors.textMuted}>
          SFF Taxi operatori
        </T>
      ) : null}
      <T variant="body">{text}</T>
      <T variant="caption" color={colors.textMuted} align="right">
        {formatDateTime(at)}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3) },
  head: { gap: space(1) },
  flex: { flex: 1 },
  bubble: { maxWidth: '85%', padding: space(3), borderRadius: radius.lg, gap: space(1) },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brandSoft },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  reply: { flexDirection: 'row', alignItems: 'flex-end', gap: space(2) },
});
