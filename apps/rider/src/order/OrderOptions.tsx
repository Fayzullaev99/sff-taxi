import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import type { RideOption, TariffInfo } from '../api/types';
import { OPTION_HINTS, OPTION_LABELS, optionPriceLabel, RIDE_OPTIONS } from '../lib/fare';
import { T } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';

/**
 * The order sheet's preferences: one switch row per choice, in one group. The car options
 * (child seat, luggage, pets, air conditioning) are here; ride-wide preferences the API
 * adds later (a shared ride with the passenger count, a female driver…) are more
 * `PreferenceRow`s in the same group (children placed before the car options).
 */
export function OrderOptions({
  selected,
  prices,
  onToggle,
  children,
}: {
  selected: readonly RideOption[];
  prices: NonNullable<TariffInfo['tariff']>['options'] | undefined;
  onToggle: (option: RideOption) => void;
  /** Extra preference rows shown first (ride-wide choices). */
  children?: ReactNode;
}) {
  return (
    <View style={styles.group}>
      {children}
      {RIDE_OPTIONS.map((o) => (
        <PreferenceRow
          key={o}
          label={OPTION_LABELS[o]}
          hint={OPTION_HINTS[o]}
          price={optionPriceLabel(prices?.[o])}
          value={selected.includes(o)}
          onChange={() => onToggle(o)}
        />
      ))}
    </View>
  );
}

/** One preference: label, hint, its price, a switch; the whole row toggles (big target). */
export const PreferenceRow = memo(function PreferenceRow({
  label,
  hint,
  price,
  value,
  onChange,
  disabled = false,
  extra,
}: {
  label: string;
  hint?: string;
  price?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Shown under the row while it is on (e.g. a passenger count). */
  extra?: ReactNode;
}) {
  return (
    <View style={styles.rowWrap}>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        accessibilityLabel={[label, hint, price].filter(Boolean).join('. ')}
        disabled={disabled}
        onPress={() => onChange(!value)}
        style={({ pressed }) => [
          styles.row,
          pressed ? styles.pressed : null,
          disabled ? styles.disabled : null,
        ]}
      >
        <View style={styles.flex}>
          <T variant="bodyStrong" numberOfLines={2}>
            {label}
          </T>
          {hint ? (
            <T variant="small" color={colors.textMuted} numberOfLines={3}>
              {hint}
            </T>
          ) : null}
        </View>
        {price ? (
          <T variant="smallStrong" color={colors.textMuted} style={styles.price}>
            {price}
          </T>
        ) : null}
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          trackColor={{ true: colors.brand, false: colors.border }}
          thumbColor={value ? colors.ink : colors.bg}
          importantForAccessibility="no"
        />
      </Pressable>
      {value && extra ? <View style={styles.extra}>{extra}</View> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  group: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  rowWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    minHeight: 60,
  },
  pressed: { backgroundColor: colors.surface },
  disabled: { opacity: 0.45 },
  flex: { flex: 1, minWidth: 0 },
  price: { maxWidth: '35%', textAlign: 'right' },
  extra: { paddingHorizontal: space(3.5), paddingBottom: space(3) },
});
