import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../i18n';
import { registerPushDevice, requestPushPermission } from '../notifications/push';
import { Button, Muted } from './components';
import { Screen } from './screen';
import { colors, radius, space } from './theme';

/** Why to allow notifications: an icon and its text (`profile.pushIntro.reasons.*`). */
const REASONS = [
  { icon: 'flash', key: 'fast' },
  { icon: 'volume-high', key: 'loud' },
  { icon: 'swap-horizontal', key: 'changes' },
] as const;

/**
 * Onboarding step shown once before the system permission prompt: drivers who allow
 * notifications get offers even with the app in the background.
 */
export function NotificationsIntro(props: { onDone: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const allow = async () => {
    setBusy(true);
    try {
      if (await requestPushPermission()) void registerPushDevice();
    } finally {
      setBusy(false);
      props.onDone();
    }
  };
  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.icon}>
          <Ionicons name="notifications" size={52} color={colors.onBrand} />
        </View>
        <Text style={styles.title}>{t('profile.pushIntro.title')}</Text>
        <Muted center>{t('profile.pushIntro.text')}</Muted>
      </View>
      <View style={styles.list}>
        {REASONS.map((r) => (
          <View key={r.icon} style={styles.reason}>
            <Ionicons name={r.icon} size={26} color={colors.brand} />
            <Text style={styles.reasonText}>{t(`profile.pushIntro.reasons.${r.key}`)}</Text>
          </View>
        ))}
      </View>
      <Button
        title={t('profile.pushIntro.allow')}
        icon="notifications"
        big
        loading={busy}
        onPress={() => void allow()}
      />
      <Button
        title={t('profile.pushIntro.later')}
        variant="ghost"
        disabled={busy}
        onPress={props.onDone}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.md, marginTop: space.xl },
  icon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  list: {
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  reason: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  reasonText: { flex: 1, fontSize: 16, color: colors.text, lineHeight: 22 },
});
