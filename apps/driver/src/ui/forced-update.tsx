import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSupport } from '../data/queries';
import { call } from './actions';
import { Button, Muted } from './components';
import { colors, space } from './theme';

const ANDROID_PACKAGE = 'uz.sff.taxi.driver';

async function openStore(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Linking.openURL(`market://details?id=${ANDROID_PACKAGE}`);
      return;
    } catch {
      // no Play Store app: the web page
    }
  }
  await Linking.openURL(`https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`).catch(
    () => undefined,
  );
}

/**
 * Shown instead of everything else while this build is older than the minimum the API
 * serves (`GET /v1/config` → `minAppVersion.driver`): old builds may misread offers or money.
 */
export function ForcedUpdate(props: { current: string; minimum: string }) {
  const support = useSupport();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Ionicons name="cloud-download" size={88} color={colors.brand} />
        <Text style={styles.title}>Ilovani yangilang</Text>
        <Muted center>
          SFF Taxi Haydovchining yangi versiyasi chiqdi. Buyurtmalarni olishda davom etish uchun
          ilovani yangilang — bu bir daqiqa oladi.
        </Muted>
        <Muted center>
          Sizda: {props.current} · kerak: {props.minimum} yoki yangiroq
        </Muted>
      </View>
      <View style={styles.actions}>
        <Button
          title="Yangilash"
          icon="logo-google-playstore"
          big
          onPress={() => void openStore()}
        />
        {support.phone ? (
          <Button
            title="Ofisga qo‘ng‘iroq qilish"
            icon="call"
            variant="secondary"
            onPress={() => call(support.phone)}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, padding: space.lg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  title: { fontSize: 28, fontWeight: '900', color: colors.text, textAlign: 'center' },
  actions: { gap: space.md },
});
