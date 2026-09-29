import { router } from 'expo-router';
import { memo, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useHistory } from '../api/queries';
import type { RideSummary } from '../api/types';
import { classLabel, SERVICE_NAMES } from '../lib/services';
import { formatDateTime, formatMoney, placeLine } from '../lib/format';
import { rideScreen } from '../lib/ride-state';
import { discountLine } from '../lib/sharing';
import { Icon, T } from '../ui/primitives';
import { EmptyView, ErrorView, LoadingView } from '../ui/states';
import { colors, radius, space } from '../ui/theme';

/** Past and current rides, newest first, 30 per page. */
export default function HistoryScreen() {
  const history = useHistory();
  const pages = history.data?.pages;
  const items = useMemo(() => pages?.flatMap((p) => p.items) ?? [], [pages]);

  if (history.isPending) return <LoadingView />;
  if (history.isError && !items.length) {
    return <ErrorView error={history.error} onRetry={() => void history.refetch()} />;
  }

  return (
    <FlatList
      style={styles.root}
      data={items}
      keyExtractor={(r) => r.id}
      contentContainerStyle={items.length ? styles.list : styles.emptyList}
      renderItem={renderRide}
      ItemSeparatorComponent={Separator}
      onEndReached={() => {
        if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={history.isRefetching && !history.isFetchingNextPage}
          onRefresh={() => void history.refetch()}
          colors={[colors.ink]}
        />
      }
      ListFooterComponent={
        history.isFetchingNextPage ? (
          <ActivityIndicator color={colors.ink} style={styles.more} />
        ) : null
      }
      ListEmptyComponent={
        <EmptyView
          icon="car-outline"
          title="Hali safarlar yo‘q"
          message="Birinchi safaringizni xaritadan buyurtma qiling."
          actionTitle="Taksi chaqirish"
          onAction={() => router.dismissTo('/home')}
        />
      }
      // light rows, no images: smooth on low-end phones
      initialNumToRender={10}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={60}
      windowSize={7}
      removeClippedSubviews
    />
  );
}

const STATUS_COLOR: Record<string, string> = {
  completed: colors.success,
  cancelled: colors.textMuted,
  no_driver: colors.warning,
};

const renderRide = ({ item }: { item: RideSummary }) => <RideRow ride={item} />;

function Separator() {
  return <View style={styles.separator} />;
}

/** One ride; memoised, so pages loaded later or a refetch do not redraw unchanged rows. */
const RideRow = memo(function RideRow({ ride }: { ride: RideSummary }) {
  const screen = rideScreen(ride);
  const amount =
    ride.status === 'completed'
      ? // what the rider paid, fees of earlier cancelled rides collected with it included
        (ride.fare.total ?? ride.fare.quoted) + (ride.fare.owedFee ?? 0)
      : ride.fare.cancellationFee > 0
        ? ride.fare.cancellationFee
        : (ride.fare.pays ?? ride.fare.quoted);
  const statusText =
    ride.status === 'completed'
      ? 'Yakunlangan'
      : screen.final
        ? screen.title
        : ride.status === 'scheduled' && ride.scheduledFor
          ? `Oldindan · ${formatDateTime(ride.scheduledFor)}`
          : ride.status === 'awaiting_payment'
            ? 'To‘lov kutilmoqda'
            : 'Faol';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${formatDateTime(ride.requestedAt)}, ${placeLine(ride.pickup)} dan ${placeLine(ride.dropoff)} ga, ${statusText}, ${formatMoney(amount)}`}
      onPress={() => router.push({ pathname: '/ride/[id]', params: { id: ride.id } })}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.surface } : null]}
    >
      <View style={styles.icon}>
        <Icon
          name={
            ride.status === 'completed'
              ? 'checkmark'
              : screen.final
                ? 'close'
                : ride.service === 'cargo'
                  ? 'cube'
                  : ride.service === 'delivery'
                    ? 'mail'
                    : 'car-sport'
          }
          size={18}
          color={colors.ink}
        />
      </View>
      <View style={styles.flex}>
        <T variant="small" color={colors.textMuted}>
          {formatDateTime(ride.requestedAt)} ·{' '}
          {ride.service && ride.service !== 'taxi' ? `${SERVICE_NAMES[ride.service]} · ` : ''}
          {classLabel(ride.class)}
        </T>
        <T variant="bodyStrong" numberOfLines={1}>
          {placeLine(ride.dropoff)}
        </T>
        <T variant="small" color={colors.textMuted} numberOfLines={1}>
          {placeLine(ride.pickup)} dan
        </T>
        <T variant="smallStrong" color={STATUS_COLOR[screen.phase] ?? colors.brandText}>
          {statusText}
        </T>
        {(ride.fare.poolDiscount ?? 0) > 0 ? (
          <T variant="small" color={colors.success} numberOfLines={1}>
            {discountLine(ride.fare.poolDiscount!)}
          </T>
        ) : null}
      </View>
      <T variant="bodyStrong">{formatMoney(amount)}</T>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  list: { paddingVertical: space(2) },
  emptyList: { flexGrow: 1 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: space(16),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(3),
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  more: { marginVertical: space(4) },
});
