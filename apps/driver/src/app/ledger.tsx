import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LedgerEntry } from '../api/types';
import { useLedger } from '../data/queries';
import { errorMessage } from '../lib/api-client';
import { dateTime, LEDGER_KINDS, som } from '../lib/format';
import { Button, EmptyState, ErrorState, Loading } from '../ui/components';
import { OfflineBanner } from '../ui/screen';
import { colors, space } from '../ui/theme';

function Entry({ item }: { item: LedgerEntry }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.kind}>{LEDGER_KINDS[item.kind] ?? item.kind}</Text>
        <Text style={styles.meta}>
          {dateTime(item.createdAt)}
          {item.note ? ` · ${item.note}` : ''}
        </Text>
      </View>
      <Text style={[styles.amount, item.amount > 0 && { color: colors.success }]}>
        {item.amount > 0 ? '+' : ''}
        {som(item.amount)}
      </Text>
    </View>
  );
}

/** Every balance movement (append-only on the server), 50 per page. A FlatList: cheap to scroll. */
export default function Ledger() {
  const router = useRouter();
  const q = useLedger();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <SafeAreaView style={styles.safe}>
      <OfflineBanner />
      <View style={styles.header}>
        <Button title="Orqaga" icon="arrow-back" variant="ghost" onPress={() => router.back()} />
        <Text style={styles.title}>Balans tarixi</Text>
      </View>
      {q.isPending ? (
        <Loading />
      ) : q.error && !items.length ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.id}
          renderItem={({ item }) => <Entry item={item} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={<EmptyState icon="wallet-outline" title="Hali amallar yo‘q" />}
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
  kind: { fontSize: 17, fontWeight: '800', color: colors.text },
  meta: { fontSize: 14, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 17, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'] },
  sep: { height: 1, backgroundColor: colors.border },
});
