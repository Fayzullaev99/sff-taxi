import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { describeError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys, useScheduledRides } from '../api/queries';
import type { RideSummary } from '../api/types';
import { confirm, notify } from '../lib/dialogs';
import { CLASS_LABELS } from '../lib/fare';
import { formatDateTime, formatMoney, formatTime, placeLine } from '../lib/format';
import { SCHEDULED_PER_RIDER, searchStartsAt } from '../lib/schedule';
import { Button, Card, Icon, PressableRow, T } from '../ui/primitives';
import { EmptyView, ErrorView, LoadingView } from '../ui/states';
import { colors, radius, space } from '../ui/theme';

/**
 * Rides ordered for later (up to three), soonest first. The search starts 15 minutes
 * before; until then a ride can be cancelled free.
 */
export default function ScheduledScreen() {
  const query = useScheduledRides();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const rides = query.data ?? [];

  const cancel = async (ride: RideSummary) => {
    const ok = await confirm({
      title: 'Oldindan buyurtmani bekor qilasizmi?',
      message: `${ride.scheduledFor ? formatDateTime(ride.scheduledFor) : ''} · ${placeLine(ride.dropoff)}. Bekor qilish bepul.`,
      confirmText: 'Bekor qilish',
      cancelText: 'Qoldirish',
      destructive: true,
    });
    if (!ok) return;
    setCancelling(ride.id);
    try {
      const updated = await endpoints.cancel(ride.id, null);
      queryClient.setQueryData(keys.ride(ride.id), updated);
      queryClient.setQueryData<RideSummary[]>(keys.scheduled, (list) =>
        list?.filter((r) => r.id !== ride.id),
      );
      void queryClient.invalidateQueries({ queryKey: keys.scheduled });
      void queryClient.invalidateQueries({ queryKey: keys.history });
    } catch (e) {
      notify('Bekor qilinmadi', describeError(e));
      void query.refetch();
    } finally {
      setCancelling(null);
    }
  };

  if (query.isPending) return <LoadingView />;
  if (query.isError && !query.data) {
    return <ErrorView error={query.error} onRetry={() => void query.refetch()} />;
  }

  return (
    <FlatList
      style={styles.root}
      data={rides}
      keyExtractor={(r) => r.id}
      contentContainerStyle={rides.length ? styles.list : styles.emptyList}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          colors={[colors.ink]}
        />
      }
      ListHeaderComponent={
        rides.length ? (
          <T variant="small" color={colors.textMuted} style={styles.note}>
            Haydovchi qidiruvi belgilangan vaqtdan 15 daqiqa oldin boshlanadi. Bir vaqtda{' '}
            {SCHEDULED_PER_RIDER} tagacha oldindan buyurtma berish mumkin.
          </T>
        ) : null
      }
      renderItem={({ item }) => (
        <Card style={styles.card}>
          <PressableRow
            style={styles.row}
            onPress={() => router.push({ pathname: '/ride/[id]', params: { id: item.id } })}
            accessibilityLabel={`${item.scheduledFor ? formatDateTime(item.scheduledFor) : ''}, ${placeLine(item.dropoff)} ga, ${formatMoney(item.fare.quoted)}`}
          >
            <View style={styles.icon}>
              <Icon name="calendar" size={20} color={colors.ink} />
            </View>
            <View style={styles.flex}>
              <T variant="h3">{item.scheduledFor ? formatDateTime(item.scheduledFor) : '—'}</T>
              <T variant="bodyStrong" numberOfLines={1}>
                {placeLine(item.dropoff)}
              </T>
              <T variant="small" color={colors.textMuted} numberOfLines={1}>
                {placeLine(item.pickup)} dan · {CLASS_LABELS[item.class]}
              </T>
              {item.scheduledFor ? (
                <T variant="small" color={colors.textMuted}>
                  Qidiruv {formatTime(searchStartsAt(item.scheduledFor))} da boshlanadi
                </T>
              ) : null}
            </View>
            <T variant="bodyStrong">{formatMoney(item.fare.quoted)}</T>
          </PressableRow>
          <Button
            title="Bekor qilish"
            variant="ghost"
            size="sm"
            loading={cancelling === item.id}
            onPress={() => void cancel(item)}
          />
        </Card>
      )}
      ListEmptyComponent={
        <EmptyView
          icon="calendar-outline"
          title="Oldindan buyurtmalar yo‘q"
          message="Tarif tanlashda “Keyinroq” ni bosib, 30 daqiqadan 24 soatgacha oldin taksi buyurtma qiling."
          actionTitle="Taksi chaqirish"
          onAction={() => router.dismissTo('/home')}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { padding: space(4), gap: space(3) },
  emptyList: { flexGrow: 1 },
  note: { marginBottom: space(1) },
  card: { gap: space(1) },
  row: { gap: space(3), alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
