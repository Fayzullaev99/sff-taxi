import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGeoConfig } from '../api/queries';
import { parseSaveTarget, saveTitle } from '../lib/places';
import { coordinatesLabel, DEFAULT_CENTER, describePoint } from '../location/geo';
import { PointPicker } from '../location/PointPicker';
import { choosePickup, updateDraft, useDraft } from '../trip/draft';
import { savePicked } from '../trip/places-store';
import { Button, T } from '../ui/primitives';
import { colors, space } from '../ui/theme';

/** A place chosen by moving the map under a pin: the destination, pickup or a saved place. */
export default function PickOnMapScreen() {
  const params = useLocalSearchParams<{ field?: string; save?: string }>();
  const field = params.field === 'pickup' ? 'pickup' : 'dropoff';
  const save = parseSaveTarget(params.save);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const config = useGeoConfig().data;
  const draft = useDraft();
  const start =
    (field === 'dropoff' ? draft.dropoff : null) ??
    draft.pickup ??
    config?.defaultCenter ??
    DEFAULT_CENTER;
  const [point, setPoint] = useState<{ lat: number; lng: number }>({
    lat: start.lat,
    lng: start.lng,
  });
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lookup = useRef(0);

  const onChange = async (lat: number, lng: number) => {
    setPoint({ lat, lng });
    const ticket = ++lookup.current;
    setBusy(true);
    const info = await describePoint(lat, lng);
    if (ticket !== lookup.current) return;
    setAddress(info.address);
    setBusy(false);
  };

  const [saving, setSaving] = useState(false);

  const done = async () => {
    const title = address ?? coordinatesLabel(point.lat, point.lng);
    if (save) {
      setSaving(true);
      const ok = await savePicked(save, { ...point, title, subtitle: null });
      setSaving(false);
      // back past the search screen to wherever the rider came from
      if (ok) router.dismiss(2);
      return;
    }
    if (field === 'pickup') {
      choosePickup({ ...point, address: title });
      router.dismiss(2);
      return;
    }
    updateDraft({ dropoff: { ...point, address: title } });
    router.replace('/order');
  };

  const title = save ? saveTitle(save) : field === 'pickup' ? 'Olib ketish joyi' : 'Borish manzili';

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title }} />
      <PointPicker
        initial={start}
        onChange={(lat, lng) => void onChange(lat, lng)}
        onMoveStart={() => setBusy(true)}
        height={Math.max(260, height * 0.62)}
      />
      <View style={[styles.panel, { paddingBottom: insets.bottom + space(4) }]}>
        <T variant="caption" color={colors.textMuted}>
          {field === 'pickup' ? 'QAYERDAN' : 'QAYERGA'}
        </T>
        <T variant="h3" numberOfLines={3}>
          {busy ? 'Manzil aniqlanmoqda…' : (address ?? coordinatesLabel(point.lat, point.lng))}
        </T>
        <Button
          title={save ? 'Saqlash' : 'Tayyor'}
          size="lg"
          disabled={busy}
          loading={saving}
          onPress={() => void done()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  panel: { flex: 1, padding: space(4), gap: space(2), justifyContent: 'flex-end' },
});
