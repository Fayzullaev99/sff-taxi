import { ScrollView, StyleSheet, View } from 'react-native';
import type { SosResult } from '../api/types';
import { callPhone, OPERATOR_PHONE } from '../lib/links';
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
  const numbers = result?.emergency ?? EMERGENCY_FALLBACK;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      footer={<Button title="Yopish" variant="secondary" size="lg" onPress={onClose} />}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <T variant="h2" accessibilityRole="header">
          Favqulodda yordam
        </T>
        {sending ? (
          <Banner tone="info" message="Operatorlarga signal yuborilmoqda…" />
        ) : failed ? (
          <Banner
            tone="danger"
            title="Signal yuborilmadi"
            message="Internet aloqasi yo‘q bo‘lishi mumkin. Quyidagi raqamlarga darhol qo‘ng‘iroq qiling."
          />
        ) : (
          <Banner
            tone="success"
            title="Operatorlar xabardor qilindi"
            message="Joylashuvingiz va safar ma’lumotlari yuborildi. Operator siz bilan bog‘lanadi."
          />
        )}
        <View style={styles.buttons}>
          <Button
            title={`Yagona xizmat — ${numbers.unified}`}
            variant="sos"
            size="lg"
            icon="call"
            onPress={() => void callPhone(numbers.unified)}
          />
          <Button
            title={`Politsiya — ${numbers.police}`}
            variant="dark"
            size="lg"
            icon="shield"
            onPress={() => void callPhone(numbers.police)}
          />
          <Button
            title={`Tez yordam — ${numbers.ambulance}`}
            variant="dark"
            size="lg"
            icon="medkit"
            onPress={() => void callPhone(numbers.ambulance)}
          />
          <Button
            title={`O‘t o‘chirish — ${numbers.fire}`}
            variant="outline"
            size="lg"
            icon="flame"
            onPress={() => void callPhone(numbers.fire)}
          />
          {OPERATOR_PHONE ? (
            <Button
              title="SFF Taxi operatori"
              variant="outline"
              size="lg"
              icon="headset"
              onPress={() => void callPhone(OPERATOR_PHONE!)}
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
