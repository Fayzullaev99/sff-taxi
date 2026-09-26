import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys, useMe } from '../api/queries';
import { signOut } from '../api/session';
import { confirm } from '../lib/dialogs';
import { formatPhone } from '../lib/format';
import { callPhone, OPERATOR_PHONE } from '../lib/links';
import { SAVED_LABELS, type SavedKind } from '../lib/places';
import { usePushPermission } from '../notifications/PushManager';
import { removePlace, usePlaces } from '../trip/places-store';
import {
  Banner,
  Button,
  Card,
  Divider,
  Icon,
  IconButton,
  PressableRow,
  SectionTitle,
  T,
  TextField,
} from '../ui/primitives';
import { colors, space } from '../ui/theme';

/** Name, saved places, notifications, the office's number, sign-out. */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const me = useMe();
  const places = usePlaces();
  const push = usePushPermission();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    if (me.data?.fullName) setName(me.data.fullName);
  }, [me.data?.fullName]);

  const saveName = async () => {
    const fullName = name.trim();
    if (!fullName) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await endpoints.updateMe(fullName);
      queryClient.setQueryData(keys.me, updated);
      setMessage({ tone: 'success', text: 'Ism saqlandi' });
    } catch (e) {
      setMessage({ tone: 'danger', text: describeError(e) });
    } finally {
      setSaving(false);
    }
  };

  const doSignOut = async () => {
    const ok = await confirm({
      title: 'Hisobdan chiqasizmi?',
      message: 'Saqlangan manzillar shu telefondan o‘chiriladi.',
      confirmText: 'Chiqish',
      destructive: true,
    });
    if (!ok) return;
    // the session guard in the root layout takes the rider to the sign-in
    await signOut();
  };

  const editPlace = (kind: SavedKind) =>
    router.push({ pathname: '/search', params: { field: 'dropoff', save: kind } });

  const pushText =
    push.permission === 'granted'
      ? 'Yoqilgan: haydovchi topilganda va yetib kelganda xabar beramiz.'
      : push.permission === 'unsupported'
        ? 'Bu qurilmada bildirishnomalar mavjud emas.'
        : 'O‘chirilgan. Haydovchi yetib kelganini bilish uchun yoqing.';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(8) }]}
      keyboardShouldPersistTaps="handled"
    >
      <Card style={styles.card}>
        <T variant="small" color={colors.textMuted}>
          Telefon
        </T>
        <T variant="h3">{me.data ? formatPhone(me.data.phone) : '…'}</T>
        <TextField
          label="Ism"
          placeholder="Haydovchi sizga shu ism bilan murojaat qiladi"
          value={name}
          onChangeText={(t) => {
            setMessage(null);
            setName(t);
          }}
          maxLength={100}
          autoComplete="name"
          returnKeyType="done"
          onSubmitEditing={() => void saveName()}
        />
        {message ? <Banner tone={message.tone} message={message.text} /> : null}
        <Button
          title="Saqlash"
          variant="dark"
          loading={saving}
          disabled={!name.trim() || name.trim() === me.data?.fullName}
          onPress={() => void saveName()}
        />
      </Card>

      <SectionTitle>Saqlangan manzillar</SectionTitle>
      <Card style={styles.card}>
        {(['home', 'work'] as const).map((kind, i) => (
          <View key={kind}>
            {i > 0 ? <Divider style={styles.divider} /> : null}
            <View style={styles.placeRow}>
              <PressableRow
                style={styles.placeMain}
                onPress={() => editPlace(kind)}
                accessibilityLabel={`${SAVED_LABELS[kind]}: ${places[kind]?.title ?? 'qo‘shilmagan'}. O‘zgartirish`}
              >
                <Icon name={kind === 'home' ? 'home-outline' : 'briefcase-outline'} size={20} />
                <View style={styles.flex}>
                  <T variant="bodyStrong">{SAVED_LABELS[kind]}</T>
                  <T variant="small" color={colors.textMuted} numberOfLines={2}>
                    {places[kind]?.title ?? 'Qo‘shish uchun bosing'}
                  </T>
                </View>
              </PressableRow>
              {places[kind] ? (
                <IconButton
                  name="trash-outline"
                  label={`${SAVED_LABELS[kind]} manzilini o‘chirish`}
                  color={colors.danger}
                  onPress={() => removePlace(kind)}
                />
              ) : null}
            </View>
          </View>
        ))}
      </Card>

      <SectionTitle>Bildirishnomalar</SectionTitle>
      <Card style={styles.card}>
        <T variant="body">{pushText}</T>
        {push.permission !== 'granted' && push.permission !== 'unsupported' ? (
          <Button
            title="Bildirishnomalarni yoqish"
            variant="secondary"
            icon="notifications-outline"
            onPress={() => void push.request()}
          />
        ) : null}
      </Card>

      <SectionTitle>Yordam</SectionTitle>
      <Card style={styles.card}>
        <T variant="body">
          Narxlar oldindan belgilanadi va yo‘lda o‘zgarmaydi. Haydovchi yetib kelgach bir necha
          daqiqa kutish bepul.
        </T>
        {OPERATOR_PHONE ? (
          <Button
            title={`Operator: ${OPERATOR_PHONE}`}
            variant="secondary"
            icon="call-outline"
            onPress={() => void callPhone(OPERATOR_PHONE!)}
          />
        ) : null}
        <Button
          title="Safarlar tarixi"
          variant="secondary"
          icon="time-outline"
          onPress={() => router.push('/history')}
        />
      </Card>

      <Button
        title="Hisobdan chiqish"
        variant="danger"
        icon="log-out-outline"
        onPress={() => void doSignOut()}
      />
      <T variant="caption" color={colors.textFaint} align="center">
        SFF Taxi {Constants.expoConfig?.version ?? ''}
      </T>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3) },
  card: { gap: space(3) },
  flex: { flex: 1, minWidth: 0 },
  divider: { marginVertical: space(1) },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  placeMain: { flex: 1, gap: space(3), minHeight: 48 },
});
