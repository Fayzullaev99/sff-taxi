import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Ride } from '../api/types';
import { cancelTerms, type RideRules } from '../lib/fare';
import { useNow } from '../lib/hooks';
import { Banner, Button, Chip, T } from '../ui/primitives';
import { Sheet } from '../ui/Sheet';
import { colors, space } from '../ui/theme';

const REASONS = [
  'Rejalarim o‘zgardi',
  'Haydovchi juda uzoqda',
  'Kutish vaqti uzoq',
  'Manzilni xato kiritdim',
  'Boshqa taksi topdim',
];

/**
 * Cancel with the price of it said upfront: free while searching and on the way, and
 * after arrival until the free waiting ends; then the tariff's fee (cancelFeeNow).
 */
export function CancelSheet({
  visible,
  ride,
  rules,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  ride: Ride;
  rules: RideRules | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const now = useNow(1000);
  const terms = cancelTerms(ride, rules, now);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      footer={
        <View style={styles.buttons}>
          <Button
            title={terms.fee > 0 ? 'Baribir bekor qilish' : 'Bekor qilish'}
            variant="danger"
            size="lg"
            loading={busy}
            onPress={() => onConfirm(reason)}
          />
          <Button
            title={ride.status === 'scheduled' ? 'Buyurtmani qoldirish' : 'Kutishda davom etish'}
            variant="secondary"
            size="lg"
            onPress={onClose}
          />
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.content}>
        <T variant="h2" accessibilityRole="header">
          Buyurtmani bekor qilasizmi?
        </T>
        <Banner tone={terms.fee > 0 ? 'warning' : 'info'} message={terms.message} />
        <T variant="smallStrong" color={colors.textMuted}>
          Sababi (ixtiyoriy)
        </T>
        <View style={styles.reasons}>
          {REASONS.map((r) => (
            <Chip
              key={r}
              label={r}
              selected={reason === r}
              onPress={() => setReason(reason === r ? null : r)}
            />
          ))}
        </View>
        {error ? <Banner tone="danger" message={error} /> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(4), paddingTop: space(6), gap: space(3) },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  buttons: { gap: space(2) },
});
