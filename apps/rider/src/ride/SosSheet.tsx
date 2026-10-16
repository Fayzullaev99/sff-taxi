import { ScrollView, StyleSheet, View } from 'react-native';
import type { SosResult } from '../api/types';
import { useSupport } from '../api/support';
import { useT } from '../i18n';
import { callPhone } from '../lib/links';
import { Banner, Button, T } from '../ui/primitives';
import { Sheet } from '../ui/Sheet';
import { space } from '../ui/theme';

/** Uzbekistan's emergency numbers; the API sends the same with every SOS. */
export const EMERGENCY_FALLBACK: SosResult['emergency'] = {
  unified: '112',
  police: '102',
  ambulance: '103',
  fire: '101',
};

/**
 * After an SOS: whether the operators were alerted, and the emergency numbers as large
 * call buttons (the alert helps, but a call to 102/103 is what brings help fastest).
 */
export function SosSheet({
  visible,
  onClose,
  result,
  sending,
  failed,
}: {
  visible: boolean;
  onClose: () => void;
  result: SosResult | null;
  sending: boolean;
  failed: boolean;
}) {
  const { t } = useT();
  const numbers = result?.emergency ?? EMERGENCY_FALLBACK;
  // the office number from /config (the build's number only as a fallback)
  const operatorPhone = useSupport().phone;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      footer={
        <Button title={t('common.actions.close')} variant="secondary" size="lg" onPress={onClose} />
      }
    >
      <ScrollView contentContainerStyle={styles.content}>
        <T variant="h2" accessibilityRole="header">
          {t('ride.sos.title')}
        </T>
        {sending ? (
          <Banner tone="info" message={t('ride.sos.sending')} />
        ) : failed ? (
          <Banner
            tone="danger"
            title={t('ride.sos.failedTitle')}
            message={t('ride.sos.failedMessage')}
          />
        ) : (
          <Banner
            tone="success"
            title={t('ride.sos.sentTitle')}
            message={t('ride.sos.sentMessage')}
          />
        )}
        <View style={styles.buttons}>
          <Button
            title={t('ride.sos.unified', { number: numbers.unified })}
            variant="sos"
            size="lg"
            icon="call"
            onPress={() => void callPhone(numbers.unified)}
          />
          <Button
            title={t('ride.sos.police', { number: numbers.police })}
            variant="dark"
            size="lg"
            icon="shield"
            onPress={() => void callPhone(numbers.police)}
          />
          <Button
            title={t('ride.sos.ambulance', { number: numbers.ambulance })}
            variant="dark"
            size="lg"
            icon="medkit"
            onPress={() => void callPhone(numbers.ambulance)}
          />
          <Button
            title={t('ride.sos.fire', { number: numbers.fire })}
            variant="outline"
            size="lg"
            icon="flame"
            onPress={() => void callPhone(numbers.fire)}
          />
          {operatorPhone ? (
            <Button
              title={t('ride.sos.operator')}
              variant="outline"
              size="lg"
              icon="headset"
              onPress={() => void callPhone(operatorPhone)}
            />
          ) : null}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(4), paddingTop: space(6), gap: space(3) },
  buttons: { gap: space(2.5) },
});
