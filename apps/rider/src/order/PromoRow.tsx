import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useT } from '../i18n';
import { formatMoney } from '../lib/format';
import type { AppliedDiscount } from '../lib/promo';
import { Icon, T } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';
import { PromoCodeEntry } from './PromoCodeEntry';

/**
 * The order screen's discount line: the promo code (or invitation) applied to the chosen
 * class, ride credit with a switch, why a saved code does not fit, and a box to enter a
 * new code (the quote is priced again with it).
 */
export function PromoRow({
  discount,
  creditBalance,
  useCredit,
  onUseCredit,
  unavailable,
}: {
  discount: AppliedDiscount | null;
  creditBalance: number;
  useCredit: boolean;
  onUseCredit: (on: boolean) => void;
  /** Rides for later and shared rides take no discount: why, instead of the box. */
  unavailable: string | null;
}) {
  const { t } = useT();
  const [entering, setEntering] = useState(false);
  if (unavailable) {
    return discount || creditBalance > 0 ? (
      <T variant="small" color={colors.textMuted}>
        {unavailable}
      </T>
    ) : null;
  }
  return (
    <View style={styles.root}>
      {discount?.promo ? (
        <View style={styles.line} accessible>
          <Icon name="pricetag" size={18} color={colors.success} />
          <T variant="smallStrong" color={colors.success} style={styles.flex}>
            {discount.promo.source === 'referral'
              ? t('order.promo.friendReferral')
              : t('order.promo.promoCode', { code: discount.promo.code })}
          </T>
          <T variant="smallStrong" color={colors.success}>
            −{formatMoney(discount.promo.amount)}
          </T>
        </View>
      ) : null}
      {discount?.note ? (
        <T variant="small" color={colors.warning}>
          {discount.note}
        </T>
      ) : null}
      {creditBalance > 0 ? (
        <View style={styles.line}>
          <Icon name="wallet-outline" size={18} color={colors.ink} />
          <View style={styles.flex}>
            <T variant="smallStrong">
              {t('order.promo.bonus')}
              {useCredit && discount?.credit ? ` −${formatMoney(discount.credit)}` : ''}
            </T>
            <T variant="caption" color={colors.textMuted}>
              {t('order.promo.balance', { amount: formatMoney(creditBalance) })}
            </T>
          </View>
          <Switch
            value={useCredit}
            onValueChange={onUseCredit}
            accessibilityLabel={t('order.promo.useBonus')}
            trackColor={{ true: colors.brand, false: colors.border }}
          />
        </View>
      ) : null}
      {entering ? (
        <PromoCodeEntry autoFocus onAdded={() => setEntering(false)} />
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setEntering(true)}
          style={({ pressed }) => [styles.add, pressed ? { opacity: 0.6 } : null]}
        >
          <Icon name="add-circle-outline" size={18} color={colors.brandText} />
          <T variant="smallStrong" color={colors.brandText}>
            {discount?.promo ? t('order.promo.anotherCode') : t('order.promo.enterCode')}
          </T>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: space(2),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  flex: { flex: 1, minWidth: 0 },
  add: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), minHeight: 32 },
});
