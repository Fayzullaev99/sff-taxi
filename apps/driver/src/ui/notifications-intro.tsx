import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { registerPushDevice, requestPushPermission } from '../notifications/push';
import { Button, Muted } from './components';
import { Screen } from './screen';
import { colors, radius, space } from './theme';

const REASONS: { icon: 'flash' | 'volume-high' | 'swap-horizontal'; text: string }[] = [
  { icon: 'flash', text: 'Yangi buyurtma kelishi bilan xabar beramiz — 15 soniyada javob bering' },
  {
    icon: 'volume-high',
    text: 'Baland, alohida ovoz va tebranish: navigator ochiq bo‘lsa ham eshitasiz',
  },
  {
    icon: 'swap-horizontal',
    text: 'Yo‘lovchi bekor qilsa yoki arizangiz ko‘rib chiqilsa, darhol bilasiz',
  },
];

/**
 * Onboarding step shown once before the system permission prompt: drivers who allow
 * notifications get offers even with the app in the background.
 */
export function NotificationsIntro(props: { onDone: () => void }) {
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
        <Text style={styles.title}>Buyurtmalarni o‘tkazib yubormang</Text>
        <Muted center>
          Bildirishnomalarga ruxsat bering — ilova yopiq yoki telefon qulflangan bo‘lsa ham
          buyurtmalar keladi.
        </Muted>
      </View>
      <View style={styles.list}>
        {REASONS.map((r) => (
          <View key={r.icon} style={styles.reason}>
            <Ionicons name={r.icon} size={26} color={colors.brand} />
            <Text style={styles.reasonText}>{r.text}</Text>
          </View>
        ))}
      </View>
      <Button
        title="Ruxsat berish"
        icon="notifications"
        big
        loading={busy}
        onPress={() => void allow()}
      />
      <Button title="Keyinroq" variant="ghost" disabled={busy} onPress={props.onDone} />
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
