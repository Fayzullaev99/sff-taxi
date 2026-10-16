import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';
import { t, useT } from '../i18n';
import { Icon, T } from './primitives';
import { colors, space } from './theme';

export const STAR_COLOR = '#F5A623';

const WORDS = [
  null,
  'ride.rating.words.w1',
  'ride.rating.words.w2',
  'ride.rating.words.w3',
  'ride.rating.words.w4',
  'ride.rating.words.w5',
] as const;

/** What the stars mean ("Yaxshi"), or the prompt to rate when none is chosen yet. */
export function starsWord(value: number | null): string {
  const key = value ? WORDS[value] : null;
  return key ? t(key) : value ? '' : t('ride.rating.rate');
}

/** "4,9" as ratings are written here. */
export function formatRating(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/** "★ 4,9" next to a driver's name. */
export function RatingBadge({ rating }: { rating: number }) {
  const { t } = useT();
  return (
    <View
      style={styles.badge}
      accessible
      accessibilityLabel={t('ride.driverCard.ratingA11y', { rating: formatRating(rating) })}
    >
      <Icon name="star" size={14} color={STAR_COLOR} />
      <T variant="smallStrong">{formatRating(rating)}</T>
    </View>
  );
}

/** Five large tap targets; the word under them says what the stars mean. */
export function StarInput({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (stars: number) => void;
  label: string;
}) {
  return (
    <View style={styles.input}>
      <View
        style={styles.row}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 1, max: 5, now: value ?? 0, text: starsWord(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const current = value ?? 0;
          if (e.nativeEvent.actionName === 'increment') onChange(Math.min(5, current + 1));
          if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(1, current - 1));
        }}
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <Pressable
            key={i}
            hitSlop={4}
            importantForAccessibility="no"
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              onChange(i);
            }}
            style={({ pressed }) => [styles.star, pressed ? styles.pressed : null]}
          >
            <Icon
              name={value !== null && i <= value ? 'star' : 'star-outline'}
              size={38}
              color={value !== null && i <= value ? STAR_COLOR : colors.textFaint}
            />
          </Pressable>
        ))}
      </View>
      <T variant="smallStrong" color={value ? colors.text : colors.textMuted}>
        {starsWord(value)}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  input: { alignItems: 'center', gap: space(1) },
  star: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.9 }] },
});
