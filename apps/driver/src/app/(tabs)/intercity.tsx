import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DriverTrip } from '../../api/types';
import { useDriverMe, useTripHistory, useUpcomingTrips } from '../../data/queries';
import { useT } from '../../i18n';
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
  const { t } = useT();
  const router = useRouter();
  const me = useDriverMe();
  const upcoming = useUpcomingTrips();
  const history = useTripHistory();
  // the API orders both lists by departure: nothing to sort here
  const live = upcoming.data ?? [];
  const past = (history.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (x) => !LIVE.has(x.status),
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
      title={t('common.screens.intercity')}
      refreshing={upcoming.isRefetching || history.isRefetching}
      onRefresh={refresh}
    >
      <Muted>{t('intercity.list.intro')}</Muted>
      {!canWork ? (
        <Banner tone="warning" icon="alert-circle" text={t('intercity.list.blocked')} />
      ) : null}
      <Button
        title={t('intercity.list.publish')}
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
          title={t('intercity.list.empty')}
          text={t('intercity.list.emptyHint')}
        />
      ) : null}

      {/* one list failed while the other has trips: the missing one says so (the upcoming
          departures are the ones that matter) */}
      {!empty && upcoming.isError && !upcoming.data ? (
        <ErrorState
          message={t('intercity.list.upcomingFailed', { error: errorMessage(upcoming.error) })}
          onRetry={() => void upcoming.refetch()}
        />
      ) : null}
      {live.length ? <SectionTitle>{t('intercity.list.upcoming')}</SectionTitle> : null}
      {live.map((x) => (
        <TripRow key={x.id} trip={x} onPress={() => router.push(`/intercity/${x.id}`)} />
      ))}
      {!empty && history.isError && !history.data ? (
        <ErrorState
          message={t('intercity.list.pastFailed', { error: errorMessage(history.error) })}
          onRetry={() => void history.refetch()}
        />
      ) : null}
      {past.length ? <SectionTitle>{t('intercity.list.past')}</SectionTitle> : null}
      {past.map((x) => (
        <TripRow key={x.id} trip={x} onPress={() => router.push(`/intercity/${x.id}`)} />
      ))}
      {history.hasNextPage ? (
        <Button
          title={t('intercity.list.showMore')}
          variant="secondary"
          loading={history.isFetchingNextPage}
          onPress={() => void history.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}

function TripRow(props: { trip: DriverTrip; onPress: () => void }) {
  const { t } = useT();
  const trip = props.trip;
  const sold = seatsSold(trip.bookings);
  const tone =
    trip.status === 'cancelled'
      ? 'neutral'
      : trip.status === 'arrived'
        ? 'success'
        : trip.status === 'departed' || trip.status === 'boarding'
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
          {trip.from.nameUz} → {trip.to.nameUz}
        </Text>
        <Text style={styles.when}>{whenLabel(trip.departureAt, Date.now())}</Text>
        <View style={styles.chips}>
          <Chip label={TRIP_STATUS_TEXT[trip.status] ?? trip.status} tone={tone} />
          <Chip
            label={t('intercity.seats.sold', { sold, total: trip.seats.total })}
            tone={sold ? 'success' : 'neutral'}
          />
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={styles.price}>{som(trip.price.rear)}</Text>
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
