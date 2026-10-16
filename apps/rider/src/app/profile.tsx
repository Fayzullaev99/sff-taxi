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
import { changeLanguage, type Language, LANGUAGES, useT } from '../i18n';
import { confirm } from '../lib/dialogs';
import { formatPhone } from '../lib/format';
import { genderLock } from '../lib/sharing';
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
  const { t } = useT();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Gender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = genderLock(me.genderLockedUntil, new Date());

  const choose = async (gender: Gender) => {
    if (gender === me.gender || busy) return;
    const ok = await confirm({
      title: t('profile.gender.confirmTitle', { gender: t(`common.gender.${gender}`) }),
      message: t('profile.gender.confirmMessage'),
      confirmText: t('common.actions.save'),
      cancelText: t('common.actions.no'),
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
        {t('profile.gender.title')}
      </T>
      <T variant="small" color={colors.textMuted}>
        {t('profile.gender.hint')}
      </T>
      <Segmented
        value={(me.gender ?? '') as Gender}
        onChange={(g) => {
          if (!lock.locked) void choose(g);
        }}
        options={(['female', 'male'] as const).map((g) => ({
          value: g,
          label: busy === g ? t('common.actions.saving') : t(`common.gender.${g}`),
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

/**
 * The app's language: applied at once (every screen re-renders), kept on the phone and on
 * the account (the API writes SMS and push in it).
 */
function LanguageCard() {
  const { t, lang } = useT();
  return (
    <Card style={styles.card}>
      <T variant="h3" accessibilityRole="header">
        {t('common.language.title')}
      </T>
      <Segmented
        value={lang}
        onChange={(next: Language) => void changeLanguage(next)}
        options={LANGUAGES.map((l) => ({ value: l, label: t(`common.language.${l}`) }))}
      />
      <T variant="small" color={colors.textMuted}>
        {t('common.language.hint')}
      </T>
    </Card>
  );
}

/** Name, the rider's places and lists, notifications, support contacts, sign-out. */
export default function ProfileScreen() {
  const { t } = useT();
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
      setMessage({ tone: 'success', text: t('profile.nameSaved') });
    } catch (e) {
      setMessage({ tone: 'danger', text: describeError(e) });
    } finally {
      setSaving(false);
    }
  };

  const doSignOut = async () => {
    const ok = await confirm({
      title: t('profile.signOut.title'),
      message: t('profile.signOut.message'),
      confirmText: t('profile.signOut.confirm'),
      destructive: true,
    });
    if (!ok) return;
    // the session guard in the root layout takes the rider to the sign-in
    await signOut();
  };

  const pushText =
    push.permission === 'granted'
      ? t('profile.push.on')
      : push.permission === 'unsupported'
        ? t('profile.push.unsupported')
        : t('profile.push.off');

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(8) }]}
      keyboardShouldPersistTaps="handled"
    >
      <Card style={styles.card}>
        <T variant="small" color={colors.textMuted}>
          {t('profile.phone')}
        </T>
        <T variant="h3">{me.data ? formatPhone(me.data.phone) : me.isError ? '—' : '…'}</T>
        {me.isError && !me.data ? (
          <Banner
            tone="warning"
            message={describeError(me.error)}
            action={
              <Button
                title={t('common.actions.retry')}
                size="sm"
                variant="secondary"
                onPress={() => void me.refetch()}
              />
            }
          />
        ) : null}
        <TextField
          label={t('profile.nameLabel')}
          placeholder={t('profile.namePlaceholder')}
          value={name}
          onChangeText={(text) => {
            setMessage(null);
            setName(text);
          }}
          maxLength={100}
          autoComplete="name"
          returnKeyType="done"
          onSubmitEditing={() => void saveName()}
        />
        {message ? <Banner tone={message.tone} message={message.text} /> : null}
        <Button
          title={t('common.actions.save')}
          variant="dark"
          loading={saving}
          disabled={!name.trim() || name.trim() === me.data?.fullName}
          onPress={() => void saveName()}
        />
      </Card>

      {me.data && me.data.gender !== undefined ? <GenderCard me={me.data} /> : null}

      <LanguageCard />

      <Card style={styles.menu}>
        <MenuRow
          icon="pricetag-outline"
          title={t('common.screens.promos')}
          subtitle={t('profile.menu.promosSubtitle')}
          onPress={() => router.push('/promos')}
        />
        <Divider />
        <MenuRow
          icon="location-outline"
          title={t('common.screens.places')}
          onPress={() => router.push('/places')}
        />
        <Divider />
        <MenuRow
          icon="time-outline"
          title={t('common.screens.history')}
          onPress={() => router.push('/history')}
        />
        {scheduledOn ? (
          <>
            <Divider />
            <MenuRow
              icon="calendar-outline"
              title={t('common.screens.scheduled')}
              onPress={() => router.push('/scheduled')}
            />
          </>
        ) : null}
        {intercityOn ? (
          <>
            <Divider />
            <MenuRow
              icon="bus-outline"
              title={t('profile.menu.intercityBookings')}
              onPress={() => router.push('/intercity/bookings')}
            />
          </>
        ) : null}
        <Divider />
        <MenuRow
          icon="chatbubbles-outline"
          title={t('common.screens.support')}
          subtitle={t('profile.menu.supportSubtitle')}
          onPress={() => router.push('/support')}
        />
      </Card>

      <SectionTitle>{t('profile.push.title')}</SectionTitle>
      <Card style={styles.card}>
        <T variant="body">{pushText}</T>
        {push.permission !== 'granted' && push.permission !== 'unsupported' ? (
          <Button
            title={t('profile.push.enable')}
            variant="secondary"
            icon="notifications-outline"
            onPress={() => void push.request()}
          />
        ) : null}
      </Card>

      <SectionTitle>{t('profile.help.title')}</SectionTitle>
      <Card style={styles.card}>
        <T variant="body">{t('profile.help.text')}</T>
        {support.phone ? (
          <Button
            title={t('common.app.operatorWithPhone', { phone: formatPhone(support.phone) })}
            variant="secondary"
            icon="call-outline"
            onPress={() => void callPhone(support.phone!)}
          />
        ) : null}
        {support.telegramUrl ? (
          <Button
            title={t('common.app.telegram', {
              handle: support.telegramHandle ?? t('common.app.telegramDefault'),
            })}
            variant="secondary"
            icon="paper-plane-outline"
            onPress={() => void openLink(support.telegramUrl!)}
          />
        ) : null}
        {support.officeAddress ? (
          <T variant="small" color={colors.textMuted}>
            {t('common.app.office', { address: support.officeAddress })}
          </T>
        ) : null}
      </Card>

      <Button
        title={t('common.actions.signOut')}
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
