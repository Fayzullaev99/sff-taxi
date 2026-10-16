import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSupport } from '../data/queries';
import { useT } from '../i18n';
import { call } from './actions';
import { Button, Muted } from './components';
import { colors, space } from './theme';

const ANDROID_PACKAGE = 'uz.sff.taxi.driver';

/** The API's store link (`storeUrls.driver`) when it publishes one, else the Play Store page. */
async function openStore(storeUrl: string | null): Promise<void> {
  if (storeUrl) {
    try {
      await Linking.openURL(storeUrl);
      return;
    } catch {
      // not openable here: the built-in links below
    }
  }
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
export function ForcedUpdate(props: { current: string; minimum: string; storeUrl: string | null }) {
  const { t } = useT();
  const support = useSupport();
  return (
    <SafeAreaView style={styles.safe}>
      {/* scrolls on a short phone or with a large font instead of pushing the buttons off */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Ionicons name="cloud-download" size={88} color={colors.brand} />
        <Text style={styles.title}>{t('profile.update.title')}</Text>
        <Muted center>{t('profile.update.text')}</Muted>
        <Muted center>
          {t('profile.update.versions', { current: props.current, minimum: props.minimum })}
        </Muted>
      </ScrollView>
      <View style={styles.actions}>
        <Button
          title={t('profile.update.update')}
          icon="logo-google-playstore"
          big
          onPress={() => void openStore(props.storeUrl)}
        />
        {support.phone ? (
          <Button
            title={t('profile.support.callOffice')}
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
  scroll: { flex: 1 },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  title: { fontSize: 28, fontWeight: '900', color: colors.text, textAlign: 'center' },
  actions: { gap: space.md },
});
