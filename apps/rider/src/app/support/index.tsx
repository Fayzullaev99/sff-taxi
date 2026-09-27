import { router } from 'expo-router';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useComplaints } from '../../api/queries';
import { useLiveRides } from '../../api/realtime';
import { useSupport } from '../../api/support';
import type { ComplaintListItem } from '../../api/types';
import { COMPLAINT_STATUS_LABELS, RESOLUTION_LABELS } from '../../lib/complaints';
import { formatDateTime, formatPhone } from '../../lib/format';
import { callPhone, openLink } from '../../lib/links';
import { Button, Icon, PressableRow, T } from '../../ui/primitives';
import { EmptyView, ErrorView, LoadingView } from '../../ui/states';
import { colors, radius, space } from '../../ui/theme';

const STATUS_COLOR = {
  open: colors.warning,
  in_progress: colors.info,
  resolved: colors.success,
} as const;

/** The rider's complaints (support tickets) with their state; new answers arrive live. */
export default function ComplaintsScreen() {
  useLiveRides();
  const complaints = useComplaints();
  const support = useSupport();
  const items = complaints.data?.pages.flatMap((p) => p.items) ?? [];

  if (complaints.isPending) return <LoadingView />;
  if (complaints.isError && !items.length) {
    return <ErrorView error={complaints.error} onRetry={() => void complaints.refetch()} />;
  }

  const contacts =
    support.phone || support.telegramUrl ? (
      <View style={styles.contacts}>
        {support.phone ? (
          <Button
            title={formatPhone(support.phone)}
            icon="call-outline"
            variant="secondary"
            size="sm"
            onPress={() => void callPhone(support.phone!)}
            style={styles.flex}
          />
        ) : null}
        {support.telegramUrl ? (
          <Button
            title="Telegram"
            icon="paper-plane-outline"
            variant="secondary"
            size="sm"
            onPress={() => void openLink(support.telegramUrl!)}
            style={styles.flex}
          />
        ) : null}
      </View>
    ) : null;

  return (
    <FlatList
      style={styles.root}
      data={items}
      keyExtractor={(c) => c.id}
      contentContainerStyle={items.length ? styles.list : styles.emptyList}
      ListHeaderComponent={
        <View style={styles.header}>
          <T variant="small" color={colors.textMuted}>
            Yangi murojaat safar sahifasidan yoziladi (safarlar tarixi → safar → “Muammo
            bo‘ldimi?”). Shoshilinch bo‘lsa, qo‘ng‘iroq qiling.
          </T>
          {contacts}
        </View>
      }
      renderItem={({ item }) => <ComplaintRow item={item} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      onEndReached={() => {
        if (complaints.hasNextPage && !complaints.isFetchingNextPage) {
          void complaints.fetchNextPage();
        }
      }}
      refreshControl={
        <RefreshControl
          refreshing={complaints.isRefetching && !complaints.isFetchingNextPage}
          onRefresh={() => void complaints.refetch()}
          colors={[colors.ink]}
        />
      }
      ListFooterComponent={
        complaints.isFetchingNextPage ? <ActivityIndicator color={colors.ink} /> : null
      }
      ListEmptyComponent={
        <EmptyView
          icon="chatbubbles-outline"
          title="Murojaatlar yo‘q"
          message="Safarda muammo bo‘lsa yoki mashinada narsangiz qolsa, safar sahifasidan yozing."
          actionTitle="Safarlar tarixi"
          onAction={() => router.push('/history')}
        />
      }
    />
  );
}

function ComplaintRow({ item }: { item: ComplaintListItem }) {
  const status = item.resolution
    ? RESOLUTION_LABELS[item.resolution]
    : COMPLAINT_STATUS_LABELS[item.status];
  return (
    <PressableRow
      style={styles.row}
      onPress={() => router.push({ pathname: '/support/[id]', params: { id: item.id } })}
      accessibilityLabel={`${item.typeLabel}, safar #${item.rideNumber}, ${status}`}
    >
      <View style={styles.icon}>
        <Icon
          name={item.type === 'lost_item' ? 'bag-handle-outline' : 'chatbubble-ellipses-outline'}
          size={18}
          color={colors.ink}
        />
      </View>
      <View style={styles.flex}>
        <T variant="bodyStrong" numberOfLines={1}>
          {item.typeLabel}
        </T>
        <T variant="small" color={colors.textMuted}>
          Safar #{item.rideNumber} · {formatDateTime(item.updatedAt)}
        </T>
        <T variant="smallStrong" color={STATUS_COLOR[item.status]}>
          {status}
        </T>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textMuted} />
    </PressableRow>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: space(8) },
  emptyList: { flexGrow: 1 },
  header: { padding: space(4), gap: space(3) },
  contacts: { flexDirection: 'row', gap: space(2) },
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
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
