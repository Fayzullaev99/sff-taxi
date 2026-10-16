import { memo } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DriverRide } from '../api/types';
import { useRides } from '../data/queries';
import { useT } from '../i18n';
import { errorMessage } from '../lib/api-client';
import { CANCEL_FEE_STATUS, dateTime, RIDE_STATUSES, som } from '../lib/format';
import { SERVICE_LABELS, serviceOf } from '../lib/service';
import { Button, EmptyState, ErrorState, Loading } from '../ui/components';
import { OfflineBanner } from '../ui/screen';
import { colors, space } from '../ui/theme';

const RideRow = memo(function RideRow({ item }: { item: DriverRide }) {
  const { t } = useT();
  const done = item.status === 'completed';
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.place} numberOfLines={1}>
          {item.dropoff.address ?? item.dropoff.landmark ?? `#${item.number}`}
        </Text>
        <Text style={styles.meta}>
          {dateTime(item.completedAt ?? item.cancelledAt ?? item.requestedAt)} ·{' '}
          {RIDE_STATUSES[item.status] ?? item.status}
          {serviceOf(item) !== 'taxi' ? ' · ' + SERVICE_LABELS[serviceOf(item)] : ''}
          {!done && item.cancelReason ? ` · ${item.cancelReason}` : ''}
        </Text>
        {!done && item.fare.cancellationFee > 0 ? (
          <Text style={styles.meta}>
            {item.fare.cancellationFeeStatus
              ? t('money.rides.cancelFee', {
                  amount: som(item.fare.cancellationFee),
                  status:
                    CANCEL_FEE_STATUS[item.fare.cancellationFeeStatus] ??
                    item.fare.cancellationFeeStatus,
                })
              : // a card ride's fee (or a lost deposit): already paid, no cash state to show
                t('money.rides.cancelFeeOnly', { amount: som(item.fare.cancellationFee) })}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.amount, !done && { color: colors.muted }]}>
          {done ? som(item.fare.total ?? item.fare.quoted) : '—'}
        </Text>
        {item.earnings ? (
          <Text style={styles.net}>{t('money.rides.net', { amount: som(item.earnings.net) })}</Text>
        ) : null}
      </View>
    </View>
  );
});

/** Completed and cancelled rides with what each earned, 30 per page. */
export default function Rides() {
  const { t } = useT();
  const router = useRouter();
  const q = useRides();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <SafeAreaView style={styles.safe}>
      <OfflineBanner />
      <View style={styles.header}>
        <Button
          title={t('common.actions.back')}
          icon="arrow-back"
          variant="ghost"
          onPress={() => router.back()}
        />
        <Text style={styles.title}>{t('money.rides.history')}</Text>
      </View>
      {q.isPending ? (
        <Loading />
      ) : q.error && !items.length ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.id}
          renderItem={({ item }) => <RideRow item={item} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={<EmptyState icon="car-outline" title={t('money.rides.empty')} />}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
          onEndReachedThreshold={0.5}
          refreshing={q.isRefetching}
          onRefresh={() => void q.refetch()}
          initialNumToRender={15}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={{ padding: space.lg }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  title: { fontSize: 22, fontWeight: '900', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  place: { fontSize: 17, fontWeight: '800', color: colors.text },
  meta: { fontSize: 14, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 17, fontWeight: '900', color: colors.text },
  net: { fontSize: 13, color: colors.success, fontWeight: '700' },
  sep: { height: 1, backgroundColor: colors.border },
});
