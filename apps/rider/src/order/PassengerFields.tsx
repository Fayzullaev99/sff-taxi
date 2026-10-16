import { Pressable, StyleSheet, View } from 'react-native';
import { useRecentPassengers } from '../api/queries';
import { useT } from '../i18n';
import { formatLocalPhoneInput } from '../lib/format';
import { checkPassenger, passengerChip } from '../lib/passenger';
import { updateDraft } from '../trip/draft';
import { T, TextField } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';
import { PreferenceRow } from './OrderOptions';

/**
 * "Boshqa odam uchun": the order is for someone else (a parent, a guest). The rider keeps
 * tracking and paying; the driver calls the passenger, who gets an SMS with the car, the
 * plate and the live link. Recent passengers are one tap away.
 */
export function PassengerFields({
  draft,
  ownPhone,
  showErrors,
}: {
  draft: { forOther: boolean; passengerName: string; passengerPhone: string };
  ownPhone: string | null;
  showErrors: boolean;
}) {
  const { t } = useT();
  const recent = useRecentPassengers(draft.forOther);
  const check = checkPassenger(draft.passengerName, draft.passengerPhone, ownPhone);
  return (
    <PreferenceRow
      label={t('order.passenger.forOther')}
      hint={t('order.passenger.forOtherHint')}
      value={draft.forOther}
      onChange={(forOther) => updateDraft({ forOther })}
      extra={
        <View style={styles.fields}>
          {recent.data?.length ? (
            <View style={styles.chips}>
              {recent.data.map((p) => (
                <Pressable
                  key={p.phone}
                  accessibilityRole="button"
                  accessibilityLabel={t('order.passenger.line', { name: passengerChip(p) })}
                  onPress={() =>
                    updateDraft({
                      passengerName: p.name,
                      passengerPhone: p.phone.replace(/^\+998/, ''),
                    })
                  }
                  style={({ pressed }) => [styles.chip, pressed ? { opacity: 0.6 } : null]}
                >
                  <T variant="smallStrong" numberOfLines={1}>
                    {passengerChip(p)}
                  </T>
                </Pressable>
              ))}
            </View>
          ) : null}
          <TextField
            label={t('order.passenger.nameLabel')}
            placeholder={t('order.passenger.namePlaceholder')}
            value={draft.passengerName}
            onChangeText={(passengerName) => updateDraft({ passengerName })}
            maxLength={100}
            autoComplete="off"
            error={showErrors ? check.nameError : null}
          />
          <TextField
            label={t('order.passenger.phoneLabel')}
            prefix="+998"
            placeholder="90 123 45 67"
            keyboardType="phone-pad"
            value={formatLocalPhoneInput(draft.passengerPhone.replace(/^\+?998/, ''))}
            onChangeText={(text) =>
              updateDraft({ passengerPhone: text.replace(/\D/g, '').slice(0, 9) })
            }
            maxLength={12}
            error={showErrors ? check.phoneError : null}
            hint={t('order.passenger.phoneHint')}
          />
          <T variant="small" color={colors.textMuted}>
            {t('order.passenger.paymentNote')}
          </T>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  fields: { gap: space(2) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: {
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    maxWidth: '100%',
  },
});
