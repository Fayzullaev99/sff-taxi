import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Quote, RideClass } from '../api/types';
import { useT } from '../i18n';
import { type ClassChoice, quoteClasses } from '../lib/fare';
import { formatMoney } from '../lib/format';
import { availabilityShort, availabilityText } from '../lib/ride-state';
import { routePrices } from '../lib/sharing';
import { Icon, type IconName, T } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';

const ICONS: Record<RideClass, IconName> = {
  economy: 'car',
  comfort: 'car-sport',
  minivan: 'bus',
  business: 'diamond',
};

/**
 * The classes of this quote as a horizontal row of cards (Yandex-style): the name, car
 * examples and seats, the fixed price and the nearest free car. Only classes switched on
 * are priced, so a class operators switched off never shows; one with no free car nearby
 * says so but stays orderable (the search may find one).
 */
export function ClassCards({
  quote,
  selected,
  onSelect,
  discountOf,
}: {
  quote: Quote;
  selected: RideClass;
  onSelect: (rideClass: RideClass) => void;
  /** The rider's promo / credit discount on a class (so'm): the old price struck through. */
  discountOf?: (rideClass: RideClass) => number;
}) {
  const { t } = useT();
  const classes = quoteClasses(quote);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('order.classes.tariff')}
    >
      {classes.map((c) => (
        <ClassCard
          key={c.id}
          choice={c}
          quote={quote}
          selected={selected === c.id}
          onSelect={onSelect}
          discount={discountOf?.(c.id) ?? 0}
        />
      ))}
    </ScrollView>
  );
}

const ClassCard = memo(function ClassCard({
  choice,
  quote,
  selected,
  onSelect,
  discount = 0,
}: {
  choice: ClassChoice;
  quote: Quote;
  selected: boolean;
  onSelect: (rideClass: RideClass) => void;
  /** The rider's promo / credit discount on this class: the old price struck through. */
  discount?: number;
}) {
  const { t } = useT();
  const fare = quote.fares[choice.id];
  if (!fare) return null;
  const availability = availabilityText(quote.availability?.[choice.id]);
  const short = availabilityShort(quote.availability?.[choice.id]);
  const noCar = quote.availability?.[choice.id]?.etaS === null;
  // a fixed route seat price (Yangiyer → Guliston 10 000) is the seat price to show
  const routeSeat = routePrices(quote, choice.id)?.seat ?? null;
  const a11y = t('order.classes.cardA11y', {
    label: choice.label,
    note: choice.note,
    price: formatMoney(fare.total - discount),
  });
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={availability ? `${a11y}. ${availability}` : a11y}
      onPress={() => onSelect(choice.id)}
      style={[styles.card, selected ? styles.cardOn : null]}
    >
      <View style={styles.head}>
        <View style={[styles.icon, selected ? { backgroundColor: colors.brand } : null]}>
          <Icon name={ICONS[choice.id]} size={22} color={colors.ink} />
        </View>
        <T variant="h3" numberOfLines={1} style={styles.flex}>
          {choice.label}
        </T>
      </View>
      {discount > 0 ? (
        <T variant="small" color={colors.textMuted} numberOfLines={1} style={styles.struck}>
          {formatMoney(fare.total)}
        </T>
      ) : null}
      <T variant="price" numberOfLines={1} color={discount > 0 ? colors.success : undefined}>
        {formatMoney(fare.total - discount)}
      </T>
      <T variant="small" color={colors.textMuted} numberOfLines={2}>
        {choice.note}
      </T>
      {routeSeat || fare.seat ? (
        <T variant="caption" color={colors.textMuted} numberOfLines={1}>
          {t('order.classes.seatPrice', { price: formatMoney(routeSeat ?? fare.seat!.rear) })}
        </T>
      ) : null}
      {short ? (
        <T variant="smallStrong" color={noCar ? colors.warning : colors.success} numberOfLines={1}>
          {short}
        </T>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { gap: space(2.5), paddingVertical: space(0.5), paddingRight: space(4) },
  card: {
    width: 168,
    gap: space(1),
    padding: space(3),
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    minHeight: 150,
  },
  cardOn: { borderColor: colors.ink, backgroundColor: colors.brandSoft },
  struck: { textDecorationLine: 'line-through' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
