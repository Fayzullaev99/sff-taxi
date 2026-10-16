import { StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import { formatLocalPhoneInput } from '../lib/format';
import { checkRecipient, parseWeight } from '../lib/services';
import { updateDraft } from '../trip/draft';
import { Banner, T, TextField } from '../ui/primitives';
import { colors, space } from '../ui/theme';

/** A parcel's problems before ordering: the weight and the recipient. */
export function parcelErrors(
  d: { parcelWeight: string; recipientName: string; recipientPhone: string },
  maxWeightKg: number,
) {
  const weight = parseWeight(d.parcelWeight, maxWeightKg);
  const recipient = checkRecipient(d.recipientName, d.recipientPhone);
  return { weight, recipient, ok: !weight.error && recipient.ok };
}

/**
 * The delivery sheet's parcel: what it is, its weight (up to the limit a taxi car takes),
 * and who receives it — the driver calls them, and they get an SMS with the car.
 */
export function ParcelFields({
  draft,
  maxWeightKg,
  showErrors,
}: {
  draft: {
    parcelDescription: string;
    parcelWeight: string;
    recipientName: string;
    recipientPhone: string;
  };
  maxWeightKg: number;
  /** Errors show once the rider tried to order (not while typing the first letters). */
  showErrors: boolean;
}) {
  const { t } = useT();
  const { weight, recipient } = parcelErrors(draft, maxWeightKg);
  return (
    <View style={styles.root}>
      <Banner
        tone="info"
        icon="cube-outline"
        message={t('order.parcel.intro', { kg: maxWeightKg })}
      />
      <TextField
        label={t('order.parcel.whatLabel')}
        placeholder={t('order.parcel.whatPlaceholder')}
        value={draft.parcelDescription}
        onChangeText={(parcelDescription) => updateDraft({ parcelDescription })}
        maxLength={300}
      />
      <TextField
        label={t('order.parcel.weightLabel', { kg: maxWeightKg })}
        placeholder={t('order.parcel.weightPlaceholder')}
        keyboardType="decimal-pad"
        value={draft.parcelWeight}
        onChangeText={(parcelWeight) => updateDraft({ parcelWeight })}
        maxLength={5}
        error={weight.error}
      />
      <T variant="h3" accessibilityRole="header" style={styles.section}>
        {t('order.parcel.recipient')}
      </T>
      <TextField
        label={t('order.parcel.recipientName')}
        placeholder={t('order.parcel.recipientNamePlaceholder')}
        value={draft.recipientName}
        onChangeText={(recipientName) => updateDraft({ recipientName })}
        maxLength={100}
        autoComplete="off"
        error={showErrors ? recipient.nameError : null}
      />
      <TextField
        label={t('order.parcel.recipientPhone')}
        prefix="+998"
        placeholder="90 123 45 67"
        keyboardType="phone-pad"
        value={formatLocalPhoneInput(draft.recipientPhone.replace(/^\+?998/, ''))}
        onChangeText={(text) =>
          updateDraft({ recipientPhone: text.replace(/\D/g, '').slice(0, 9) })
        }
        maxLength={12}
        error={showErrors ? recipient.phoneError : null}
        hint={t('order.parcel.recipientPhoneHint')}
      />
      <T variant="small" color={colors.textMuted}>
        {t('order.parcel.notifications')}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space(3) },
  section: { marginTop: space(2) },
});
