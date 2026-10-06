import { router } from 'expo-router';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useBookings } from '../../api/queries';
import { useLiveRides } from '../../api/realtime';
import type { IntercityBooking } from '../../api/types';
import { formatDateTime, formatMoney } from '../../lib/format';
import { BOOKING_STATUS_LABELS } from '../../lib/intercity';
import { Icon, PressableRow, T } from '../../ui/primitives';
import { EmptyView, ErrorView, LoadingView } from '../../ui/states';
import { colors, radius, space } from '../../ui/theme';

const STATUS_COLOR: Record<IntercityBooking['status'], string> = {
  awaiting_payment: colors.warning,
  booked: colors.success,
  boarded: colors.info,
  completed: colors.textMuted,
  cancelled: colors.textMuted,
  no_show: colors.warning,
};

/** The rider's intercity bookings, newest first; changes arrive live. */
export default function BookingsScreen() {
  useLiveRides();
  const bookings = useBookings();
  const items = bookings.data?.pages.flatMap((p) => p.items) ?? [];

  if (bookings.isPending) return <LoadingView />;
  if (bookings.isError && !items.length) {
    return <ErrorView error={bookings.error} onRetry={() => void bookings.refetch()} />;
  }

  return (
    <FlatList
      style={styles.root}
      data={items}
      keyExtractor={(b) => b.id}
      contentContainerStyle={items.length ? styles.list : styles.emptyList}
      renderItem={({ item }) => <BookingRow booking={item} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      onEndReached={() => {
        if (bookings.hasNextPage && !bookings.isFetchingNextPage) void bookings.fetchNextPage();
      }}
      refreshControl={
        <RefreshControl
          refreshing={bookings.isRefetching && !bookings.isFetchingNextPage}
          onRefresh={() => void bookings.refetch()}
          colors={[colors.ink]}
        />
      }
      ListFooterComponent={
        bookings.isFetchingNextPage ? <ActivityIndicator color={colors.ink} /> : null
      }
      ListEmptyComponent={
        <EmptyView
          icon="bus-outline"
          title="Bronlar yo‘q"
          message="Shaharlararo qatnovlardan joy band qiling: narx oldindan ma’lum, joy kichik oldindan to‘lov bilan band qilinadi, qolgani naqd."
          actionTitle="Qatnovlarni ko‘rish"
          onAction={() => router.replace('/intercity')}
        />
      }
    />
  );
}

function BookingRow({ booking }: { booking: IntercityBooking }) {
  const t = booking.trip;
  return (
    <PressableRow
      style={styles.row}
      onPress={() =>
        router.push({ pathname: '/intercity/booking/[id]', params: { id: booking.id } })
      }
      accessibilityLabel={`${t.from.nameUz} dan ${t.to.nameUz} ga, ${formatDateTime(t.departureAt)}, ${BOOKING_STATUS_LABELS[booking.status]}`}
    >
      <View style={styles.icon}>
        <Icon name="bus" size={18} color={colors.ink} />
      </View>
      <View style={styles.flex}>
        <T variant="bodyStrong" numberOfLines={1}>
          {t.from.nameUz} → {t.to.nameUz}
        </T>
        <T variant="small" color={colors.textMuted}>
          {formatDateTime(t.departureAt)} · {booking.seats} joy{booking.front ? ' (old)' : ''}
        </T>
        <T variant="smallStrong" color={STATUS_COLOR[booking.status]}>
          {BOOKING_STATUS_LABELS[booking.status]}
        </T>
      </View>
      <T variant="bodyStrong">{formatMoney(booking.price)}</T>
    </PressableRow>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { paddingVertical: space(2) },
  emptyList: { flexGrow: 1 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: space(16),
  },
  row: { gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3) },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
