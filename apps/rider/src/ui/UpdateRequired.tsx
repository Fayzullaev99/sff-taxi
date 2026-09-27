import { Modal, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_VERSION, useSupport, useUpdateRequired } from '../api/support';
import { callPhone, openLink } from '../lib/links';
import { Button, Icon, T } from './primitives';
import { colors, space } from './theme';

/**
 * Over everything when GET /config says this version is below the riders' minimum: the
 * API may have changed in a way this version cannot follow (orders, payments). Nothing
 * underneath can be used, the back button included; only the store and the office.
 */
export function UpdateRequired() {
  const { required, minimum, store } = useUpdateRequired();
  const support = useSupport();
  const insets = useSafeAreaInsets();
  if (!required) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={() => undefined} statusBarTranslucent>
      <View
        style={[
          styles.root,
          { paddingTop: insets.top + space(10), paddingBottom: insets.bottom + space(6) },
        ]}
      >
        <View style={styles.icon}>
          <Icon name="arrow-up-circle" size={56} color={colors.ink} />
        </View>
        <T variant="h1" align="center" accessibilityRole="header">
          Ilovani yangilang
        </T>
        <T variant="body" align="center" color={colors.textMuted}>
          SFF Taxi’ning yangi versiyasi chiqdi. Buyurtma berishda davom etish uchun ilovani
          yangilang.
        </T>
        <T variant="small" align="center" color={colors.textFaint}>
          Sizda: {APP_VERSION ?? '?'} · kerak: {minimum ?? '?'}
        </T>
        <View style={styles.flex} />
        {store ? (
          <Button
            title={Platform.OS === 'ios' ? 'App Store’da yangilash' : 'Google Play’da yangilash'}
            size="lg"
            icon={Platform.OS === 'ios' ? 'logo-apple-appstore' : 'logo-google-playstore'}
            onPress={() => void openLink(store.primary, store.fallback ?? undefined)}
          />
        ) : (
          <T variant="bodyStrong" align="center">
            App Store’dan SFF Taxi ilovasini yangilang.
          </T>
        )}
        {support.phone ? (
          <Button
            title="Operator orqali buyurtma"
            variant="secondary"
            size="lg"
            icon="call"
            onPress={() => void callPhone(support.phone!)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: space(6),
    gap: space(3),
  },
  flex: { flex: 1 },
  icon: {
    alignSelf: 'center',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(3),
  },
});
