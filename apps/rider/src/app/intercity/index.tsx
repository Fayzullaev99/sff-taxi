import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useIntercityPoints, useIntercityTrips } from '../../api/queries';
import type { IntercityPoint, IntercityTrip } from '../../api/types';
import { CLASS_LABELS } from '../../lib/fare';
import { formatDistance, formatMoney, formatTime } from '../../lib/format';
import { MAX_SEATS, searchDates } from '../../lib/intercity';
import { Banner, Button, Chip, Icon, IconButton, RadioMark, Stepper, T } from '../../ui/primitives';
import { formatRating } from '../../ui/Rating';
import { Sheet } from '../../ui/Sheet';
import { EmptyView, ErrorView, Skeleton } from '../../ui/states';
import { colors, radius, space } from '../../ui/theme';

/** The last search, kept while the app runs: back from a trip, the board is as it was. */
let lastSearch: { from: string | null; to: string | null; date: string | null; seats: number } = {
  from: null,
  to: null,
  date: null,
  seats: 1,
};

/**
 * The intercity trip board: drivers' departures between towns (Sirdaryo towns, Tashkent)
 * with fixed seat prices. The rider picks the towns, the day and how many seats, then a
 * departure to book.
 */
export default function IntercityScreen() {
  const points = useIntercityPoints();
  const dates = useMemo(() => searchDates(new Date()), []);
  const [from, setFrom] = useState<string | null>(lastSearch.from);
  const [to, setTo] = useState<string | null>(lastSearch.to);
  const [date, setDate] = useState<string>(
    lastSearch.date && dates.some((d) => d.value === lastSearch.date)
      ? lastSearch.date
      : dates[0]!.value,
  );
  const [seats, setSeats] = useState(lastSearch.seats);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);

  const list = points.data ?? [];
  // Guliston is the home town: the default departure
  const fromSlug = from ?? list.find((p) => p.slug === 'guliston')?.slug ?? list[0]?.slug ?? null;
  const byRef = (slug: string | null) => list.find((p) => p.slug === slug) ?? null;
  const q = fromSlug && to && fromSlug !== to ? { from: fromSlug, to, date, seats } : null;
  useEffect(() => {
    lastSearch = { from: fromSlug, to, date, seats };
  }, [fromSlug, to, date, seats]);
  const trips = useIntercityTrips(q);

  const header = (
    <View style={styles.form}>
      <View style={styles.towns}>
        <View style={styles.flex}>
          <TownField label="QAYERDAN" point={byRef(fromSlug)} onPress={() => setPicking('from')} />
          <View style={styles.townGap} />
          <TownField label="QAYERGA" point={byRef(to)} onPress={() => setPicking('to')} />
        </View>
        <IconButton
          name="swap-vertical"
          label="Shaharlarni almashtirish"
          size={44}
          background={colors.surface}
          onPress={() => {
            if (!to) return;
            setFrom(to);
            setTo(fromSlug);
          }}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dates}
      >
        {dates.map((d) => (
          <Chip
            key={d.value}
            label={d.label}
            selected={d.value === date}
            onPress={() => setDate(d.value)}
          />
        ))}
      </ScrollView>

      <View style={styles.seatsRow}>
        <T variant="bodyStrong" style={styles.flex}>
          Yo‘lovchilar
        </T>
        <Stepper value={seats} min={1} max={MAX_SEATS} onChange={setSeats} />
      </View>

      <Button
        title="Bronlarim"
        icon="ticket-outline"
        variant="outline"
        size="sm"
        onPress={() => router.push('/intercity/bookings')}
      />

      {points.isError ? (
        <ErrorView error={points.error} onRetry={() => void points.refetch()} />
      ) : null}
      {!to && list.length ? (
        <Banner
          tone="info"
          message="Qayerga borishingizni tanlang — shu kunning qatnovlari chiqadi."
        />
      ) : null}
      {q && trips.isPending ? (
        <View style={styles.gap}>
          <Skeleton height={96} />
          <Skeleton height={96} />
        </View>
      ) : null}
      {q && trips.isError ? (
        <ErrorView error={trips.error} onRetry={() => void trips.refetch()} />
      ) : null}
    </View>
  );

  const results = q ? (trips.data ?? []) : [];

  return (
    <>
      <FlatList
        style={styles.root}
        data={results}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TripCard
            trip={item}
            onPress={() =>
              router.push({
                pathname: '/intercity/trip/[id]',
                params: { id: item.id, seats: String(seats) },
              })
            }
          />
        )}
        ListEmptyComponent={
          q && trips.isSuccess && !trips.isPlaceholderData ? (
            <EmptyView
              icon="bus-outline"
              title="Bu kunga qatnov yo‘q"
              message="Boshqa kunni tanlang yoki keyinroq qarang: haydovchilar qatnovlarni 7 kun oldin e’lon qiladi."
            />
          ) : null
        }
      />
      <Sheet visible={picking !== null} onClose={() => setPicking(null)}>
        <T variant="h2" accessibilityRole="header" style={styles.sheetTitle}>
          {picking === 'from' ? 'Qayerdan?' : 'Qayerga?'}
        </T>
        <ScrollView style={styles.sheetList}>
          {list
            .filter((p) => (picking === 'from' ? p.slug !== to : p.slug !== fromSlug))
            .map((p) => {
              const selected = (picking === 'from' ? fromSlug : to) === p.slug;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => {
                    if (picking === 'from') setFrom(p.slug);
                    else setTo(p.slug);
                    setPicking(null);
                  }}
                  style={({ pressed }) => [styles.townRow, pressed ? styles.pressed : null]}
                >
                  <View style={styles.flex}>
                    <T variant="bodyStrong">{p.nameUz}</T>
                    <T variant="small" color={colors.textMuted} numberOfLines={1}>
                      {p.meetingPoint}
                    </T>
                  </View>
                  <RadioMark selected={selected} />
                </Pressable>
              );
            })}
        </ScrollView>
      </Sheet>
    </>
  );
}

function TownField({
  label,
  point,
  onPress,
}: {
  label: string;
  point: IntercityPoint | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label === 'QAYERDAN' ? 'Qayerdan' : 'Qayerga'}: ${point?.nameUz ?? 'tanlanmagan'}. Tanlash`}
      onPress={onPress}
      style={({ pressed }) => [styles.townField, pressed ? styles.pressed : null]}
    >
      <T variant="caption" color={colors.textMuted}>
        {label}
      </T>
      <T variant="bodyStrong" color={point ? colors.text : colors.placeholder}>
        {point?.nameUz ?? 'Shaharni tanlang'}
      </T>
    </Pressable>
  );
}

function TripCard({ trip, onPress }: { trip: IntercityTrip; onPress: () => void }) {
  const car = `${trip.vehicle.colour} ${trip.vehicle.make} ${trip.vehicle.model}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Soat ${formatTime(trip.departureAt)}, ${car}, ${trip.seats.free} ta bo‘sh joy, orqa o‘rindiq ${formatMoney(trip.price.rear)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.cardTop}>
        <T variant="h2">{formatTime(trip.departureAt)}</T>
        <View style={styles.flex}>
          <T variant="bodyStrong" numberOfLines={1}>
            {trip.from.nameUz} → {trip.to.nameUz}
          </T>
          <T variant="small" color={colors.textMuted} numberOfLines={1}>
            {car} · {CLASS_LABELS[trip.class]} · {formatDistance(trip.distanceM)}
          </T>
        </View>
      </View>
      <View style={styles.cardBottom}>
        <View style={styles.flex}>
          <T variant="small" color={colors.textMuted}>
            {trip.driver.name} · ★ {formatRating(trip.driver.rating)}
          </T>
          <T variant="smallStrong" color={trip.seats.free > 1 ? colors.success : colors.warning}>
            {trip.seats.free} ta bo‘sh joy{trip.seats.frontFree ? ' · old o‘rindiq bor' : ''}
          </T>
        </View>
        <View style={styles.priceCol}>
          <T variant="price">{formatMoney(trip.price.rear)}</T>
          {trip.seats.frontFree ? (
            <T variant="caption" color={colors.textMuted}>
              oldinda {formatMoney(trip.price.front)}
            </T>
          ) : null}
        </View>
        <Icon name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: space(8) },
  form: { padding: space(4), gap: space(3) },
  flex: { flex: 1, minWidth: 0 },
  gap: { gap: space(2.5) },
  towns: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  townGap: { height: space(2) },
  townField: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
    minHeight: 56,
  },
  dates: { gap: space(2), paddingVertical: space(1) },
  seatsRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  card: {
    marginHorizontal: space(4),
    marginBottom: space(3),
    padding: space(3.5),
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    gap: space(2.5),
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  priceCol: { alignItems: 'flex-end' },
  pressed: { backgroundColor: colors.surface },
  sheetTitle: { padding: space(4), paddingTop: space(6) },
  sheetList: { maxHeight: 440 },
  townRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(4),
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
