import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, describeError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys, useMe } from '../api/queries';
import { signOut } from '../api/session';
import { APP_VERSION, useFeature, useSupport } from '../api/support';
import { confirm } from '../lib/dialogs';
import { formatPhone } from '../lib/format';
import { GENDER_LABELS, genderLock } from '../lib/sharing';
import type { Gender, Me } from '../api/types';
import { callPhone, openLink } from '../lib/links';
import { usePushPermission } from '../notifications/PushManager';
import {
  Banner,
  Button,
  Card,
  Divider,
  Icon,
  type IconName,
  PressableRow,
  SectionTitle,
  Segmented,
  T,
  TextField,
} from '../ui/primitives';
import { colors, space } from '../ui/theme';

/**
 * The declared gender: a woman driver is offered to women. Changeable once per 30 days
 * (the API answers 409 before that and says until when).
 */
function GenderCard({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Gender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = genderLock(me.genderLockedUntil, new Date());

  const choose = async (gender: Gender) => {
    if (gender === me.gender || busy) return;
    const ok = await confirm({
      title: `Jins: ${GENDER_LABELS[gender]}`,
      message:
        'Jinsni 30 kunda bir marta o‘zgartirish mumkin. Ayol haydovchi tanlovi faqat ayollar uchun.',
      confirmText: 'Saqlash',
      cancelText: 'Yo‘q',
    });
    if (!ok) return;
    setBusy(gender);
    setError(null);
    try {
      const updated = await endpoints.updateGender(gender);
      queryClient.setQueryData(keys.me, updated);
      // the order screen's "Ayol haydovchi" follows the profile
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        void queryClient.invalidateQueries({ queryKey: keys.me });
      }
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={styles.card}>
      <T variant="h3" accessibilityRole="header">
        Jinsingiz
      </T>
      <T variant="small" color={colors.textMuted}>
        Ayollar buyurtmada «Ayol haydovchi»ni tanlashi mumkin.
      </T>
      <Segmented
        value={(me.gender ?? '') as Gender}
        onChange={(g) => {
          if (!lock.locked) void choose(g);
        }}
        options={(['female', 'male'] as const).map((g) => ({
          value: g,
          label: busy === g ? 'Saqlanmoqda…' : GENDER_LABELS[g],
          icon: g === 'female' ? 'woman-outline' : 'man-outline',
          disabled: lock.locked && me.gender !== g,
        }))}
      />
      {lock.text ? (
        <T variant="small" color={colors.textMuted}>
          {lock.text}
        </T>
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}
    </Card>
  );
}

/** Name, the rider's places and lists, notifications, support contacts, sign-out. */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const me = useMe();
  const push = usePushPermission();
  const support = useSupport();
  const intercityOn = useFeature('intercity');
  const scheduledOn = useFeature('scheduledRides');
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
      message: 'Saqlangan manzillar va safarlar hisobingizda qoladi: qayta kirganda ko‘rasiz.',
      confirmText: 'Chiqish',
      destructive: true,
    });
    if (!ok) return;
    // the session guard in the root layout takes the rider to the sign-in
    await signOut();
  };

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

      {me.data && me.data.gender !== undefined ? <GenderCard me={me.data} /> : null}

      <Card style={styles.menu}>
        <MenuRow
          icon="location-outline"
          title="Saqlangan manzillar"
          onPress={() => router.push('/places')}
        />
        <Divider />
        <MenuRow
          icon="time-outline"
          title="Safarlar tarixi"
          onPress={() => router.push('/history')}
        />
        {scheduledOn ? (
          <>
            <Divider />
            <MenuRow
              icon="calendar-outline"
              title="Oldindan buyurtmalar"
              onPress={() => router.push('/scheduled')}
            />
          </>
        ) : null}
        {intercityOn ? (
          <>
            <Divider />
            <MenuRow
              icon="bus-outline"
              title="Shaharlararo bronlarim"
              onPress={() => router.push('/intercity/bookings')}
            />
          </>
        ) : null}
        <Divider />
        <MenuRow
          icon="chatbubbles-outline"
          title="Murojaatlarim"
          subtitle="Shikoyatlar va unutilgan narsalar"
          onPress={() => router.push('/support')}
        />
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
        {support.phone ? (
          <Button
            title={`Operator: ${formatPhone(support.phone)}`}
            variant="secondary"
            icon="call-outline"
            onPress={() => void callPhone(support.phone!)}
          />
        ) : null}
        {support.telegramUrl ? (
          <Button
            title={`Telegram: ${support.telegramHandle ?? 'yordam'}`}
            variant="secondary"
            icon="paper-plane-outline"
            onPress={() => void openLink(support.telegramUrl!)}
          />
        ) : null}
        {support.officeAddress ? (
          <T variant="small" color={colors.textMuted}>
            Ofis: {support.officeAddress}
          </T>
        ) : null}
      </Card>

      <Button
        title="Hisobdan chiqish"
        variant="danger"
        icon="log-out-outline"
        onPress={() => void doSignOut()}
      />
      <T variant="caption" color={colors.textFaint} align="center">
        SFF Taxi {APP_VERSION ?? ''}
      </T>
    </ScrollView>
  );
}

function MenuRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <PressableRow style={styles.menuRow} onPress={onPress} accessibilityLabel={title}>
      <Icon name={icon} size={20} />
      <View style={styles.flex}>
        <T variant="bodyStrong">{title}</T>
        {subtitle ? (
          <T variant="small" color={colors.textMuted}>
            {subtitle}
          </T>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textMuted} />
    </PressableRow>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3) },
  card: { gap: space(3) },
  menu: { gap: 0, paddingVertical: space(1) },
  menuRow: { gap: space(3), minHeight: 52 },
  flex: { flex: 1, minWidth: 0 },
});
