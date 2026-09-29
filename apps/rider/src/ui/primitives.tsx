import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  type ColorValue,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { colors, radius, space, type as typeScale, type TypeVariant } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({
  name,
  size = 20,
  color = colors.text,
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

// Text ------------------------------------------------------------------------------

/** How far text follows the system font size (accessibility settings). */
export const MAX_FONT_SCALE = 1.5;

export function T({
  variant = 'body',
  color = colors.text,
  align,
  style,
  ...rest
}: TextProps & { variant?: TypeVariant; color?: string; align?: 'left' | 'center' | 'right' }) {
  return (
    <Text
      // large system fonts are honoured up to 1.5×: beyond that the fixed-price cards and
      // the bottom sheet would push the order button off small screens
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...rest}
      style={[typeScale[variant], { color }, align ? { textAlign: align } : null, style]}
    />
  );
}

// Buttons ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'sos';

const buttonColors: Record<
  ButtonVariant,
  { bg: string; pressed: string; fg: string; border?: string }
> = {
  primary: { bg: colors.brandStrong, pressed: colors.brandPressed, fg: colors.onBrand },
  dark: { bg: colors.ink, pressed: colors.inkPressed, fg: colors.onInk },
  secondary: { bg: colors.surface, pressed: colors.surfacePressed, fg: colors.text },
  outline: { bg: colors.bg, pressed: colors.surface, fg: colors.text, border: colors.border },
  ghost: { bg: 'transparent', pressed: colors.surface, fg: colors.brandText },
  danger: { bg: colors.dangerSoft, pressed: '#f9d9d6', fg: colors.danger },
  sos: { bg: colors.dangerStrong, pressed: '#a31f1f', fg: '#ffffff' },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  trailing,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Right-aligned text, e.g. the total on a checkout button. */
  trailing?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const c = buttonColors[variant];
  const inactive = disabled || loading;
  // min-height, not height: large system fonts may wrap nothing but still grow the text;
  // a small button still gets a 48 dp touch area through its hit slop
  const height = size === 'lg' ? 56 : size === 'sm' ? 40 : 48;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={size === 'sm' ? 4 : undefined}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: height,
          backgroundColor: pressed && !inactive ? c.pressed : c.bg,
          borderColor: c.border ?? 'transparent',
          borderWidth: c.border ? StyleSheet.hairlineWidth * 2 : 0,
          opacity: disabled && !loading ? 0.45 : 1,
          paddingHorizontal: size === 'sm' ? space(3) : space(5),
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} color={c.fg} /> : null}
          <T
            variant={size === 'sm' ? 'smallStrong' : 'bodyStrong'}
            color={c.fg}
            numberOfLines={1}
            style={trailing ? styles.buttonGrow : null}
          >
            {title}
          </T>
          {trailing ? (
            <T variant="bodyStrong" color={c.fg}>
              {trailing}
            </T>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  name,
  onPress,
  label,
  size = 40,
  color = colors.text,
  background = colors.bg,
  style,
}: {
  name: IconName;
  onPress?: () => void;
  label: string;
  size?: number;
  color?: string;
  background?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? colors.surfacePressed : background,
        },
        style,
      ]}
    >
      <Icon name={name} size={Math.round(size * 0.5)} color={color} />
    </Pressable>
  );
}

// Inputs ----------------------------------------------------------------------------

export function TextField({
  label,
  error,
  hint,
  style,
  prefix,
  ...input
}: Omit<TextInputProps, 'style'> & {
  label?: string;
  error?: string | null;
  hint?: string;
  prefix?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.field, style]}>
      {label ? (
        <T variant="smallStrong" color={colors.textMuted} style={styles.fieldLabel}>
          {label}
        </T>
      ) : null}
      <View
        style={[
          styles.inputWrap,
          { borderColor: error ? colors.danger : 'transparent' },
          input.multiline ? styles.inputMultiline : null,
        ]}
      >
        {prefix ? (
          <T variant="body" color={colors.textMuted} style={styles.prefix}>
            {prefix}
          </T>
        ) : null}
        <TextInput
          placeholderTextColor={colors.placeholder}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          {...input}
          style={[styles.input, input.multiline ? styles.inputTextMultiline : null]}
        />
      </View>
      {error ? (
        <T variant="small" color={colors.danger} style={styles.fieldNote}>
          {error}
        </T>
      ) : hint ? (
        <T variant="small" color={colors.textMuted} style={styles.fieldNote}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  accessibilityLabel,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? colors.text
            : pressed
              ? colors.surfacePressed
              : colors.surface,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={selected ? colors.bg : colors.text} /> : null}
      <T
        variant="smallStrong"
        color={selected ? colors.bg : colors.text}
        numberOfLines={1}
        style={styles.chipText}
      >
        {label}
      </T>
    </Pressable>
  );
}

/** Two or three mutually exclusive choices side by side (cash / card). */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: { value: V; label: string; icon?: IconName; disabled?: boolean }[];
  onChange: (value: V) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: !!o.disabled }}
            disabled={o.disabled}
            onPress={() => onChange(o.value)}
            style={[
              styles.segment,
              on ? styles.segmentOn : null,
              o.disabled ? styles.segmentDisabled : null,
            ]}
          >
            {o.icon ? (
              <Icon name={o.icon} size={18} color={on ? colors.text : colors.textMuted} />
            ) : null}
            <T variant="bodyStrong" color={on ? colors.text : colors.textMuted} numberOfLines={1}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  compact = false,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  compact?: boolean;
}) {
  const size = compact ? 30 : 38;
  return (
    <View style={[styles.stepper, { height: size }]}>
      <IconButton
        name={value - 1 <= 0 && min === 0 ? 'trash-outline' : 'remove'}
        label="Kamaytirish"
        size={size}
        background={colors.surface}
        onPress={() => value > min && onChange(value - 1)}
      />
      <T
        variant={compact ? 'smallStrong' : 'bodyStrong'}
        align="center"
        style={{ minWidth: compact ? 22 : 30 }}
      >
        {value}
      </T>
      <IconButton
        name="add"
        label="Ko‘paytirish"
        size={size}
        background={colors.surface}
        onPress={() => value < max && onChange(value + 1)}
      />
    </View>
  );
}

// Surfaces --------------------------------------------------------------------------

type Tone = 'info' | 'warning' | 'danger' | 'success';

const toneColors: Record<Tone, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: colors.infoSoft, fg: colors.info, icon: 'information-circle' },
  warning: { bg: colors.warningSoft, fg: colors.warning, icon: 'alert-circle' },
  danger: { bg: colors.dangerSoft, fg: colors.danger, icon: 'close-circle' },
  success: { bg: colors.successSoft, fg: colors.success, icon: 'checkmark-circle' },
};

export function Banner({
  tone = 'info',
  title,
  message,
  icon,
  action,
  style,
}: {
  tone?: Tone;
  title?: string;
  message?: string;
  icon?: IconName;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = toneColors[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }, style]}>
      <Icon name={icon ?? t.icon} size={20} color={t.fg} />
      <View style={styles.bannerBody}>
        {title ? (
          <T variant="bodyStrong" color={colors.text}>
            {title}
          </T>
        ) : null}
        {message ? (
          <T variant="small" color={colors.text}>
            {message}
          </T>
        ) : null}
        {action}
      </View>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function Row({
  children,
  style,
  gap = 2,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
}) {
  return <View style={[styles.row, { gap: space(gap) }, style]}>{children}</View>;
}

export function PressableRow({
  children,
  onPress,
  style,
  ...rest
}: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { opacity: 0.6 } : null, style]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

/** A section title inside forms and summaries. */
export function SectionTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <T variant="h3" accessibilityRole="header" numberOfLines={2} style={styles.keyLabel}>
        {children}
      </T>
      {right}
    </View>
  );
}

/** Label on the left, value on the right: totals, details. */
export function KeyValue({
  label,
  value,
  strong = false,
  valueColor,
}: {
  label: string;
  value: string;
  strong?: boolean;
  valueColor?: string;
}) {
  return (
    <View style={styles.keyValue}>
      <T
        variant={strong ? 'h3' : 'body'}
        color={strong ? colors.text : colors.textMuted}
        style={styles.keyLabel}
      >
        {label}
      </T>
      <T
        variant={strong ? 'h3' : 'bodyStrong'}
        color={valueColor ?? colors.text}
        align="right"
        style={styles.keyValueText}
      >
        {value}
      </T>
    </View>
  );
}

export function RadioMark({ selected, square = false }: { selected: boolean; square?: boolean }) {
  return (
    <View
      style={[
        styles.radio,
        square ? { borderRadius: 6 } : null,
        selected ? { borderColor: colors.brand, backgroundColor: colors.brand } : null,
      ]}
    >
      {selected ? <Icon name="checkmark" size={14} color={colors.onBrand} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    borderRadius: radius.md,
    paddingVertical: space(2),
  },
  buttonGrow: { flex: 1 },
  field: { gap: space(1.5) },
  fieldLabel: { marginLeft: space(1) },
  fieldNote: { marginLeft: space(1) },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space(3.5),
    minHeight: 50,
  },
  inputMultiline: { alignItems: 'flex-start', paddingVertical: space(2) },
  prefix: { marginRight: space(1.5) },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: space(3) },
  inputTextMultiline: { minHeight: 72, textAlignVertical: 'top' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    paddingHorizontal: space(3.5),
    minHeight: 48,
    maxWidth: 240,
    borderRadius: radius.pill,
  },
  chipText: { flexShrink: 1 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    minHeight: 48,
    borderRadius: radius.sm + 2,
    paddingHorizontal: space(2),
  },
  segmentOn: {
    backgroundColor: colors.bg,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmentDisabled: { opacity: 0.4 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
  },
  banner: {
    flexDirection: 'row',
    gap: space(3),
    padding: space(3.5),
    borderRadius: radius.md,
    alignItems: 'flex-start',
  },
  bannerBody: { flex: 1, gap: space(0.5) },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: space(4),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(3),
    marginBottom: space(3),
  },
  keyValue: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(1),
  },
  keyLabel: { flexShrink: 1 },
  // long addresses wrap instead of pushing the label off screen
  keyValueText: { flexShrink: 1, maxWidth: '65%' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
