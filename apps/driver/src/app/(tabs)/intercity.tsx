import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DriverTrip } from '../../api/types';
import { useDriverMe, useTripHistory, useUpcomingTrips } from '../../data/queries';
import { errorMessage } from '../../lib/api-client';
import { som } from '../../lib/format';
import { seatsSold, TRIP_STATUS_TEXT } from '../../lib/intercity';
import { whenLabel } from '../../lib/when';
import {
  Banner,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  Muted,
  SectionTitle,
} from '../../ui/components';
import { Screen } from '../../ui/screen';
import { colors, radius, space } from '../../ui/theme';

const LIVE = new Set(['scheduled', 'boarding', 'departed']);

/**
 * The driver's intercity departures: the ones coming (and the one on the road), soonest
 * first (`scope=upcoming`), then the past ones (`scope=all`, latest first, paged). A new
 * departure is published from here; each opens its passenger list.
 */
export default function Intercity() {
  const router = useRouter();
  const me = useDriverMe();
  const upcoming = useUpcomingTrips();
  const history = useTripHistory();
  // the API orders both lists by departure: nothing to sort here
  const live = upcoming.data ?? [];
  const past = (history.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (t) => !LIVE.has(t.status),
  );
  const empty = !live.length && !past.length;
  const pending = upcoming.isPending || history.isPending;
  const error = upcoming.error ?? history.error;
  const refresh = () => {
    void upcoming.refetch();
    void history.refetch();
  };
  const canWork = (me.data?.blockers ?? []).filter((b) => !/balans/i.test(b)).length === 0;

  return (
    <Screen
      title="Shaharlararo"
      refreshing={upcoming.isRefetching || history.isRefetching}
      onRefresh={refresh}
    >
      <Muted>
        Qatnov e’lon qiling: yo‘lovchilar ilova yoki operator orqali joy band qiladi. Joy narxi naqd
        to‘lanadi, yetib kelganda har bir yo‘lovchidan komissiya va soliq yechiladi.
      </Muted>
      {!canWork ? (
        <Banner
          tone="warning"
          icon="alert-circle"
          text="Qatnov e’lon qilish uchun hisobingiz faol va litsenziya kartochkasi tasdiqlangan bo‘lishi kerak."
        />
      ) : null}
      <Button
        title="Yangi qatnov e’lon qilish"
        icon="add-circle"
        big
        onPress={() => router.push('/intercity/new')}
      />

      {pending && empty ? (
        <Loading />
      ) : error && empty ? (
        <ErrorState message={errorMessage(error)} onRetry={refresh} />
      ) : empty ? (
        <EmptyState
          icon="bus-outline"
          title="Hali qatnovlar yo‘q"
          text="Masalan: Guliston → Toshkent, ertaga 07:00, 4 o‘rin."
        />
      ) : null}

      {live.length ? <SectionTitle>Kelayotgan</SectionTitle> : null}
      {live.map((t) => (
        <TripRow key={t.id} trip={t} onPress={() => router.push(`/intercity/${t.id}`)} />
      ))}
      {past.length ? <SectionTitle>O‘tganlar</SectionTitle> : null}
      {past.map((t) => (
        <TripRow key={t.id} trip={t} onPress={() => router.push(`/intercity/${t.id}`)} />
      ))}
      {history.hasNextPage ? (
        <Button
          title="Yana ko‘rsatish"
          variant="secondary"
          loading={history.isFetchingNextPage}
          onPress={() => void history.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}

function TripRow(props: { trip: DriverTrip; onPress: () => void }) {
  const t = props.trip;
  const sold = seatsSold(t.bookings);
  const tone =
    t.status === 'cancelled'
      ? 'neutral'
      : t.status === 'arrived'
        ? 'success'
        : t.status === 'departed' || t.status === 'boarding'
          ? 'warning'
          : 'brand';
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.route} numberOfLines={1}>
          {t.from.nameUz} → {t.to.nameUz}
        </Text>
        <Text style={styles.when}>{whenLabel(t.departureAt, Date.now())}</Text>
        <View style={styles.chips}>
          <Chip label={TRIP_STATUS_TEXT[t.status] ?? t.status} tone={tone} />
          <Chip label={`${sold}/${t.seats.total} o‘rin`} tone={sold ? 'success' : 'neutral'} />
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={styles.price}>{som(t.price.rear)}</Text>
        <Ionicons name="chevron-forward" size={24} color={colors.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  route: { fontSize: 19, fontWeight: '900', color: colors.text },
  when: { fontSize: 16, fontWeight: '700', color: colors.brand },
  chips: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
  price: { fontSize: 16, fontWeight: '800', color: colors.text },
});
