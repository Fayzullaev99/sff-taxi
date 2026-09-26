import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps, memo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { colors, radius, space, TOUCH } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';

const BUTTON_COLORS: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.brand, fg: colors.onBrand, border: colors.brand },
  secondary: { bg: colors.surfaceRaised, fg: colors.text, border: colors.border },
  success: { bg: colors.success, fg: colors.onSuccess, border: colors.success },
  danger: { bg: 'transparent', fg: colors.danger, border: colors.danger },
  ghost: { bg: 'transparent', fg: colors.brand, border: 'transparent' },
};

export const Button = memo(function Button(props: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const c = BUTTON_COLORS[props.variant ?? 'primary'];
  const disabled = props.disabled || props.loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!props.loading }}
      accessibilityHint={props.accessibilityHint}
      onPress={props.onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        props.big && styles.buttonBig,
        { backgroundColor: c.bg, borderColor: c.border },
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.45 },
        props.style,
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {props.icon ? (
            <Ionicons name={props.icon} size={props.big ? 26 : 20} color={c.fg} />
          ) : null}
          <Text style={[styles.buttonText, props.big && styles.buttonTextBig, { color: c.fg }]}>
            {props.title}
          </Text>
        </>
      )}
    </Pressable>
  );
});

export function Card(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

export function Title(props: { children: ReactNode }) {
  return <Text style={styles.title}>{props.children}</Text>;
}

export function Muted(props: { children: ReactNode; center?: boolean }) {
  return (
    <Text style={[styles.muted, props.center && { textAlign: 'center' }]}>{props.children}</Text>
  );
}

export type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const TONES: Record<Tone, { bg: string; fg: string }> = {
  brand: { bg: colors.brandSoft, fg: colors.brand },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  info: { bg: colors.infoSoft, fg: colors.info },
  neutral: { bg: colors.surfaceRaised, fg: colors.muted },
};

export function Chip(props: { label: string; tone?: Tone; icon?: IconName }) {
  const t = TONES[props.tone ?? 'neutral'];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      {props.icon ? <Ionicons name={props.icon} size={14} color={t.fg} /> : null}
      <Text style={[styles.chipText, { color: t.fg }]}>{props.label}</Text>
    </View>
  );
}

export function Banner(props: {
  text: string;
  title?: string;
  tone?: Tone;
  icon?: IconName;
  action?: ReactNode;
}) {
  const t = TONES[props.tone ?? 'info'];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg, borderColor: t.fg }]}>
      {props.icon ? <Ionicons name={props.icon} size={22} color={t.fg} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        {props.title ? (
          <Text style={[styles.bannerTitle, { color: t.fg }]}>{props.title}</Text>
        ) : null}
        <Text style={[styles.bannerText, { color: props.title ? colors.text : t.fg }]}>
          {props.text}
        </Text>
      </View>
      {props.action}
    </View>
  );
}

export function ErrorState(props: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
      <Text style={styles.errorText}>{props.message}</Text>
      {props.onRetry ? (
        <Button title="Qayta urinish" icon="refresh" variant="secondary" onPress={props.onRetry} />
      ) : null}
    </View>
  );
}

export function EmptyState(props: { icon: IconName; title: string; text?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={props.icon} size={48} color={colors.border} />
      <Text style={styles.emptyTitle}>{props.title}</Text>
      {props.text ? <Muted center>{props.text}</Muted> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}

export function Field(
  props: TextInputProps & { label: string; error?: string | null; hint?: string },
) {
  const { label, error, hint, style, ...input } = props;
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        selectionColor={colors.brand}
        {...input}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
      />
      {error ? (
        <Text style={styles.fieldError}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** A label/value row, e.g. "Soliq (1%) — 120 so‘m". */
export function Row(props: { label: string; value: string; strong?: boolean; tone?: Tone }) {
  const color = props.tone ? TONES[props.tone].fg : colors.text;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{props.label}</Text>
      <Text style={[styles.rowValue, props.strong && styles.rowStrong, { color }]}>
        {props.value}
      </Text>
    </View>
  );
}

/** A big on/off row: the whole row is the touch target. */
export function ToggleRow(props: {
  label: string;
  description?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value, disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={() => props.onChange(!props.value)}
      style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.toggleLabel}>{props.label}</Text>
        {props.description ? <Text style={styles.muted}>{props.description}</Text> : null}
      </View>
      <Switch
        value={props.value}
        disabled={props.disabled}
        onValueChange={props.onChange}
        trackColor={{ true: colors.brand, false: colors.border }}
        thumbColor={colors.text}
      />
    </Pressable>
  );
}

/** Pick one or several of a few options (chips big enough to hit while parked). */
export function Choice<T extends string>(props: {
  options: { value: T; label: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  disabled?: (value: T) => boolean;
}) {
  return (
    <View style={styles.choices}>
      {props.options.map((o) => {
        const on = props.selected.includes(o.value);
        const off = props.disabled?.(o.value) ?? false;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: off }}
            disabled={off}
            onPress={() => props.onToggle(o.value)}
            style={({ pressed }) => [
              styles.choice,
              on && styles.choiceOn,
              off && { opacity: 0.4 },
              pressed && { opacity: 0.8 },
            ]}
          >
            {on ? <Ionicons name="checkmark" size={18} color={colors.onBrand} /> : null}
            <Text style={[styles.choiceText, on && { color: colors.onBrand }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionTitle(props: { children: ReactNode }) {
  return <Text style={styles.section}>{props.children}</Text>;
}

export const styles = StyleSheet.create({
  toggle: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md },
  toggleLabel: { fontSize: 17, fontWeight: '600', color: colors.text },
  button: {
    minHeight: TOUCH,
    borderRadius: radius.md,
    borderWidth: 2,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonBig: { minHeight: 68 },
  buttonText: { fontSize: 17, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
  buttonTextBig: { fontSize: 20 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  section: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontSize: 14, fontWeight: '700' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderLeftWidth: 4,
  },
  bannerTitle: { fontSize: 16, fontWeight: '800' },
  bannerText: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.lg,
  },
  errorText: { fontSize: 16, color: colors.text, textAlign: 'center' },
  empty: { alignItems: 'center', padding: space.xl, gap: space.sm },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' },
  label: { fontSize: 15, fontWeight: '700', color: colors.text },
  hint: { fontSize: 14, color: colors.muted },
  input: {
    minHeight: TOUCH,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    fontSize: 18,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  fieldError: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  rowLabel: { fontSize: 15, color: colors.muted, flexShrink: 1 },
  rowValue: { fontSize: 15, color: colors.text, textAlign: 'right', flexShrink: 1 },
  rowStrong: { fontSize: 17, fontWeight: '800' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choice: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choiceOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  choiceText: { fontSize: 16, fontWeight: '700', color: colors.text },
});
