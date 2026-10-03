import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { geo } from '../api/driver';
import { useDriverMe, useIntercityPoints } from '../data/queries';
import { errorMessage } from '../lib/api-client';
import { type Destination, preferencesError } from '../lib/pool';
import { loadRecentDestinations, rememberDestination, usePreferences } from '../home/preferences';
import { Banner, Button, Field, Muted, SectionTitle } from '../ui/components';
import { Screen } from '../ui/screen';
import { colors, radius, space } from '../ui/theme';

/** Wait for a pause in typing before asking the geocoder. */
const SEARCH_DELAY_MS = 450;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * "Qayerga ketyapsiz?": where the driver is heading, so only rides on the way are offered
 * (and people riding without the app have a destination). Towns of the region are one tap,
 * recent places next, then an address search. The driver app has no map SDK (light on cheap
 * phones), so there is no pin to drag. `?extra=N` also sets the people in the car.
 */
export default function DestinationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ extra?: string }>();
  const extra = params.extra !== undefined ? Number(params.extra) : undefined;
  const me = useDriverMe();
  const towns = useIntercityPoints();
  const prefs = usePreferences();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), SEARCH_DELAY_MS);
  const [recent, setRecent] = useState<Destination[]>([]);
  useEffect(() => {
    void loadRecentDestinations().then(setRecent);
  }, []);

  const near = me.data?.location ? { lat: me.data.location.lat, lng: me.data.location.lng } : null;
  const search = useQuery({
    queryKey: ['geo', 'search', query, near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''],
    queryFn: ({ signal }) => geo.search(query, near, signal),
    enabled: query.length >= 2,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const pick = (d: Destination) => {
    if (prefs.isPending) return;
    prefs.mutate(
      {
        destination: { lat: d.lat, lng: d.lng, address: d.address },
        ...(extra !== undefined && Number.isFinite(extra) ? { extraPassengers: extra } : {}),
      },
      {
        onSuccess: () => {
          void rememberDestination(d);
          if (router.canGoBack()) router.back();
          else router.replace('/home');
        },
      },
    );
  };

  return (
    <Screen title="Qayerga ketyapsiz?" onBack={() => router.back()} keyboard>
      <Muted>
        Faqat yo‘lingizdagi buyurtmalar keladi. Manzilga yetganingizda filtr o‘zi o‘chadi.
      </Muted>
      {extra ? (
        <Banner
          tone="info"
          icon="people"
          text={`Mashinada ${extra} kishi: ular qayerga ketayotganini belgilang.`}
        />
      ) : null}
      {prefs.error ? (
        <Banner tone="danger" icon="alert-circle" text={preferencesError(prefs.error)} />
      ) : null}
      {prefs.isPending ? <ActivityIndicator color={colors.brand} /> : null}

      <Field
        label="Manzilni qidirish"
        value={q}
        onChangeText={setQ}
        placeholder="Masalan: Yangiyer, bozor"
        autoCorrect={false}
        returnKeyType="search"
      />
      {query.length >= 2 ? (
        search.isPending ? (
          <ActivityIndicator color={colors.brand} />
        ) : search.isError ? (
          <Banner
            tone="danger"
            icon="cloud-offline"
            text={errorMessage(search.error)}
            action={
              <Button
                title="Qayta urinish"
                icon="refresh"
                variant="secondary"
                onPress={() => void search.refetch()}
              />
            }
          />
        ) : search.data?.length ? (
          search.data.map((a) => (
            <Row
              key={`${a.lat},${a.lng}`}
              icon="location"
              title={a.title}
              subtitle={a.subtitle}
              onPress={() =>
                pick({
                  lat: a.lat,
                  lng: a.lng,
                  address: a.subtitle ? `${a.title}, ${a.subtitle}` : a.title,
                })
              }
            />
          ))
        ) : (
          <Muted>Hech narsa topilmadi. Boshqacha yozib ko‘ring yoki shaharni tanlang.</Muted>
        )
      ) : null}

      {recent.length ? (
        <>
          <SectionTitle>Oxirgi manzillar</SectionTitle>
          {recent.map((d) => (
            <Row
              key={`${d.lat},${d.lng}`}
              icon="time"
              title={d.address ?? 'Belgilangan nuqta'}
              onPress={() => pick(d)}
            />
          ))}
        </>
      ) : null}

      <SectionTitle>Shaharlar</SectionTitle>
      {towns.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : towns.isError ? (
        <Banner
          tone="danger"
          icon="cloud-offline"
          text={errorMessage(towns.error)}
          action={
            <Button
              title="Qayta urinish"
              icon="refresh"
              variant="secondary"
              onPress={() => void towns.refetch()}
            />
          }
        />
      ) : towns.data?.length === 0 ? (
        <Muted>Shaharlar ro‘yxati hozircha bo‘sh. Manzilni qidiring.</Muted>
      ) : (
        <View style={styles.towns}>
          {(towns.data ?? []).map((t) => (
            <Pressable
              key={t.id}
              onPress={() => pick({ lat: t.lat, lng: t.lng, address: t.nameUz })}
              accessibilityRole="button"
              style={({ pressed }) => [styles.town, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.townText}>{t.nameUz}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

function Row(props: {
  icon: 'location' | 'time';
  title: string;
  subtitle?: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={props.icon} size={22} color={colors.brand} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  rowSub: { color: colors.muted, fontSize: 14 },
  towns: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  town: {
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  townText: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
