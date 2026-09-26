import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { describeError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { useGeoConfig } from '../api/queries';
import type { GeoSuggestion } from '../api/types';
import { useDebounced } from '../lib/hooks';
import { type Place, SAVED_LABELS, type SavedKind } from '../lib/places';
import { describePoint, locateDevice } from '../location/geo';
import { choosePickup, updateDraft, useDraft } from '../trip/draft';
import { savePlace, usePlaces } from '../trip/places-store';
import { notify } from '../lib/dialogs';
import { Icon, type IconName, IconButton, T } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';

type Field = 'pickup' | 'dropoff';

/**
 * Address search for the destination (or the pickup, or a saved place): suggestions from
 * the API's geocoder biased to the rider's city, plus home/work, recent destinations,
 * "my location" and "choose on the map".
 */
export default function SearchScreen() {
  const params = useLocalSearchParams<{ field?: string; save?: string }>();
  const field: Field = params.field === 'pickup' ? 'pickup' : 'dropoff';
  const save: SavedKind | null =
    params.save === 'home' || params.save === 'work' ? params.save : null;
  const config = useGeoConfig().data;
  const draft = useDraft();
  const places = usePlaces();
  const [text, setText] = useState('');
  const [locating, setLocating] = useState(false);
  const q = useDebounced(text.trim(), 400);
  const near = draft.pickup
    ? { lat: +draft.pickup.lat.toFixed(2), lng: +draft.pickup.lng.toFixed(2) }
    : null;
  const search = useQuery({
    queryKey: ['geo', 'search', q, near?.lat, near?.lng],
    queryFn: ({ signal }) => endpoints.geoSearch(q, near, signal),
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const pick = (place: Place) => {
    Keyboard.dismiss();
    if (save) {
      savePlace(save, place);
      router.back();
      return;
    }
    const point = { lat: place.lat, lng: place.lng, address: place.title };
    if (field === 'pickup') {
      choosePickup(point);
      router.back();
      return;
    }
    updateDraft({ dropoff: point });
    router.replace('/order');
  };

  const pickSuggestion = (s: GeoSuggestion) =>
    pick({ lat: s.lat, lng: s.lng, title: s.title, subtitle: s.subtitle });

  const hereAsPickup = async () => {
    setLocating(true);
    const r = await locateDevice();
    if (!r.ok) {
      setLocating(false);
      notify('Joylashuv aniqlanmadi', 'GPS yoqilganini va ruxsat berilganini tekshiring.');
      return;
    }
    const info = await describePoint(r.lat, r.lng);
    setLocating(false);
    pick({ lat: r.lat, lng: r.lng, title: info.address ?? 'Mening joylashuvim', subtitle: null });
  };

  const onMap = () =>
    router.push({
      pathname: '/pick-on-map',
      params: { field, ...(save ? { save } : {}) },
    });

  const title = save
    ? `${SAVED_LABELS[save]} manzili`
    : field === 'pickup'
      ? 'Qayerdan?'
      : 'Qayerga?';
  const searching = q.length >= 2;
  const results = searching ? (search.data ?? []) : [];
  const noGeocoder = config?.geocoder === 'none';

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title }} />
      <View style={styles.inputRow}>
        <Icon name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={
            field === 'pickup' ? 'Qayerdan olib ketamiz?' : 'Ko‘cha, mahalla yoki joy nomi'
          }
          placeholderTextColor={colors.placeholder}
          style={styles.field}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          maxLength={200}
          accessibilityLabel="Manzilni qidirish"
        />
        {search.isFetching ? <ActivityIndicator color={colors.ink} /> : null}
        {text ? (
          <IconButton
            name="close-circle"
            label="Tozalash"
            size={34}
            color={colors.textFaint}
            background="transparent"
            onPress={() => setText('')}
          />
        ) : null}
      </View>

      <FlatList
        data={results}
        keyExtractor={(s, i) => `${s.lat},${s.lng},${i}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            {!searching ? (
              <>
                {field === 'pickup' && !save ? (
                  <Row
                    icon="navigate"
                    title="Mening joylashuvim"
                    subtitle={locating ? 'Aniqlanmoqda…' : 'GPS bo‘yicha'}
                    onPress={() => void hereAsPickup()}
                  />
                ) : null}
                {!save
                  ? (['home', 'work'] as const).map((kind) =>
                      places[kind] ? (
                        <Row
                          key={kind}
                          icon={kind === 'home' ? 'home' : 'briefcase'}
                          title={SAVED_LABELS[kind]}
                          subtitle={places[kind]!.title}
                          onPress={() => pick(places[kind]!)}
                        />
                      ) : null,
                    )
                  : null}
                <Row
                  icon="map-outline"
                  title="Xaritada belgilash"
                  subtitle="Pinni kerakli joyga qo‘ying"
                  onPress={onMap}
                />
                {noGeocoder ? (
                  <T variant="small" color={colors.textMuted} style={styles.note}>
                    Manzil qidiruvi hozircha ishlamayapti — joyni xaritada belgilang.
                  </T>
                ) : null}
                {places.recent.length && !save ? (
                  <T variant="smallStrong" color={colors.textMuted} style={styles.section}>
                    OXIRGI MANZILLAR
                  </T>
                ) : null}
                {!save
                  ? places.recent.map((p, i) => (
                      <Row
                        key={`${p.lat},${p.lng},${i}`}
                        icon="time-outline"
                        title={p.title}
                        subtitle={p.subtitle}
                        onPress={() => pick(p)}
                      />
                    ))
                  : null}
              </>
            ) : null}
            {searching && search.isSuccess && results.length === 0 ? (
              <T variant="body" color={colors.textMuted} style={styles.note}>
                Hech narsa topilmadi. Boshqacha yozib ko‘ring yoki joyni xaritada belgilang.
              </T>
            ) : null}
            {searching && search.isError ? (
              <T variant="body" color={colors.danger} style={styles.note}>
                {describeError(search.error)}
              </T>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Row
            icon="location-outline"
            title={item.title}
            subtitle={[
              item.subtitle,
              field === 'pickup' && !item.serviceable ? 'bu yerdan hozircha olib ketmaymiz' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            dim={field === 'pickup' && !item.serviceable}
            onPress={() => pickSuggestion(item)}
          />
        )}
        ListFooterComponent={
          searching ? <Row icon="map-outline" title="Xaritada belgilash" onPress={onMap} /> : null
        }
      />
    </View>
  );
}

function Row({
  icon,
  title,
  subtitle,
  onPress,
  dim = false,
}: {
  icon: IconName;
  title: string;
  subtitle?: string | null;
  onPress: () => void;
  dim?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.surface } : null]}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={18} color={dim ? colors.textFaint : colors.ink} />
      </View>
      <View style={styles.flex}>
        <T variant="bodyStrong" numberOfLines={2} color={dim ? colors.textMuted : colors.text}>
          {title}
        </T>
        {subtitle ? (
          <T variant="small" color={colors.textMuted} numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    marginHorizontal: space(4),
    marginTop: space(2),
    marginBottom: space(2),
    paddingLeft: space(3.5),
    paddingRight: space(1),
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  field: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: space(3) },
  list: { paddingBottom: space(8) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    minHeight: 56,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginHorizontal: space(4), marginTop: space(4), marginBottom: space(1) },
  note: { marginHorizontal: space(4), marginVertical: space(3) },
});
