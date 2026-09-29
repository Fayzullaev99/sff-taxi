import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
import { parseSaveTarget, type Place, SAVED_LABELS, savedToPlace, saveTitle } from '../lib/places';
import { describePoint } from '../location/geo';
import { LocationNotice, useLocator } from '../location/useLocator';
import { NATIVE_MAP } from '../location/MapFallback';
import { choosePickup, updateDraft, useDraft, getDraft, orderPath } from '../trip/draft';
import { hideRecentPlace, savePicked, usePlaces } from '../trip/places-store';
import { confirm } from '../lib/dialogs';
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
  const save = parseSaveTarget(params.save);
  const config = useGeoConfig().data;
  const draft = useDraft();
  const places = usePlaces();
  const [text, setText] = useState('');
  const [describing, setDescribing] = useState(false);
  const [saving, setSaving] = useState(false);
  // one request per pause in typing; a newer query cancels the one in flight (its signal)
  const q = useDebounced(text.trim(), 350);
  const near = draft.pickup
    ? { lat: +draft.pickup.lat.toFixed(2), lng: +draft.pickup.lng.toFixed(2) }
    : null;
  const search = useQuery({
    queryKey: ['geo', 'search', q, near?.lat, near?.lng],
    queryFn: ({ signal }) => endpoints.geoSearch(q, near, signal),
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
    // the previous suggestions stay while the next ones load: no blank flash per letter
    placeholderData: keepPreviousData,
  });

  /** `address`: the text for the driver, when the title is only a label ("Mening joylashuvim"). */
  const pick = async (place: Place, address: string | null = place.title) => {
    Keyboard.dismiss();
    if (save) {
      if (saving) return;
      setSaving(true);
      const ok = await savePicked(save, place);
      setSaving(false);
      if (ok) router.back();
      return;
    }
    const point = { lat: place.lat, lng: place.lng, address };
    if (field === 'pickup') {
      choosePickup(point);
      router.back();
      return;
    }
    updateDraft({ dropoff: point });
    router.replace(orderPath(getDraft().service));
  };

  const pickSuggestion = (s: GeoSuggestion) =>
    void pick({ lat: s.lat, lng: s.lng, title: s.title, subtitle: s.subtitle });

  const pickHere = async ({ fix }: { fix: { lat: number; lng: number } }) => {
    setDescribing(true);
    const info = await describePoint(fix.lat, fix.lng);
    setDescribing(false);
    void pick(
      {
        lat: fix.lat,
        lng: fix.lng,
        title: info.address ?? 'Mening joylashuvim',
        subtitle: null,
      },
      info.address,
    );
  };
  const locator = useLocator((found) => void pickHere(found));
  const locating = locator.locating || describing;
  const hereAsPickup = () => {
    if (!locating) void locator.locateAndReport('precise');
  };

  const onMap = () =>
    router.push({
      pathname: '/pick-on-map',
      params: { field, ...(save ? { save } : {}) },
    });

  const title = save ? saveTitle(save) : field === 'pickup' ? 'Qayerdan?' : 'Qayerga?';
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
            size={44}
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
                    subtitle={locating ? 'Aniqlanmoqda…' : 'GPS bo‘yicha, aniq joy'}
                    onPress={hereAsPickup}
                  />
                ) : null}
                {field === 'pickup' && !save && locator.problem ? (
                  <View style={styles.notice}>
                    <LocationNotice
                      problem={locator.problem}
                      withMap={NATIVE_MAP}
                      onSolve={() => void locator.solve()}
                      onDismiss={locator.dismiss}
                    />
                  </View>
                ) : null}
                {!save
                  ? (['home', 'work'] as const).map((kind) =>
                      places[kind] ? (
                        <Row
                          key={kind}
                          icon={kind === 'home' ? 'home' : 'briefcase'}
                          title={SAVED_LABELS[kind]}
                          subtitle={savedToPlace(places[kind]!).title}
                          onPress={() => void pick(savedToPlace(places[kind]!))}
                        />
                      ) : null,
                    )
                  : null}
                {!save
                  ? places.others.map((p) => {
                      const place = savedToPlace(p);
                      return (
                        <Row
                          key={p.id}
                          icon="star"
                          title={place.subtitle ?? place.title}
                          subtitle={place.subtitle ? place.title : null}
                          onPress={() => void pick(place)}
                        />
                      );
                    })
                  : null}
                {saving ? (
                  <T variant="small" color={colors.textMuted} style={styles.note}>
                    Saqlanmoqda…
                  </T>
                ) : null}
                <Row
                  icon="map-outline"
                  title={NATIVE_MAP ? 'Xaritada belgilash' : 'Joyni belgilash'}
                  subtitle={
                    NATIVE_MAP ? 'Pinni kerakli joyga qo‘ying' : 'Joylashuvingiz yoki koordinatalar'
                  }
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
                        key={p.recentKey ?? String(i)}
                        icon="time-outline"
                        title={p.title}
                        subtitle={p.subtitle}
                        onPress={() => void pick(p)}
                        // long press, the eye button or the screen reader's action
                        onHide={p.recentKey ? () => void askToHide(p) : undefined}
                      />
                    ))
                  : null}
              </>
            ) : null}
            {searching && search.isSuccess && !search.isPlaceholderData && results.length === 0 ? (
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

/** Asks, then takes a recent destination off the list (the ride history keeps it). */
async function askToHide(place: Place) {
  const ok = await confirm({
    title: 'Manzilni yashirish',
    message: `«${place.title}» oxirgi manzillardan olib tashlanadi. Safarlar tarixi o‘zgarmaydi; shu yerga yana borsangiz, ro‘yxatda qayta paydo bo‘ladi.`,
    confirmText: 'Yashirish',
    cancelText: 'Yo‘q',
  });
  if (ok && place.recentKey) await hideRecentPlace(place.recentKey);
}

function Row({
  icon,
  title,
  subtitle,
  onPress,
  onHide,
  dim = false,
}: {
  icon: IconName;
  title: string;
  subtitle?: string | null;
  onPress: () => void;
  /** A recent destination: long press or the eye button takes it off the list. */
  onHide?: () => void;
  dim?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityHint={onHide ? 'Yashirish uchun bosib turing' : undefined}
      accessibilityActions={onHide ? [{ name: 'hide', label: 'Yashirish' }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'hide') onHide?.();
      }}
      onLongPress={onHide}
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
      {onHide ? (
        <IconButton name="eye-off-outline" label="Yashirish" size={44} onPress={onHide} />
      ) : null}
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
  notice: { marginHorizontal: space(4), marginBottom: space(2) },
});
