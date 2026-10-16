import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGeoConfig } from '../api/queries';
import { useT } from '../i18n';
import { parseSaveTarget, saveTitle } from '../lib/places';
import { coordinatesLabel, DEFAULT_CENTER, describePoint } from '../location/geo';
import { PointPicker } from '../location/PointPicker';
import { choosePickup, getDraft, orderPath, setStop, updateDraft, useDraft } from '../trip/draft';
import { setEditStop, useStopEdit } from '../trip/stop-edit';
import { savePicked } from '../trip/places-store';
import { Button, T } from '../ui/primitives';
import { colors, space } from '../ui/theme';

/** A place chosen by moving the map under a pin: the destination, pickup or a saved place. */
export default function PickOnMapScreen() {
  const { t } = useT();
  const params = useLocalSearchParams<{
    field?: string;
    save?: string;
    index?: string;
    /** A stop of a ride that is on (the ride's stops screen), not of the order draft. */
    ride?: string;
  }>();
  const field = params.field === 'pickup' ? 'pickup' : params.field === 'stop' ? 'stop' : 'dropoff';
  const stopIndex = Number(params.index ?? 0) || 0;
  const rideEdit = field === 'stop' && typeof params.ride === 'string' ? params.ride : null;
  const save = parseSaveTarget(params.save);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const config = useGeoConfig().data;
  const draft = useDraft();
  const edit = useStopEdit();
  const start =
    (field === 'dropoff' ? draft.dropoff : null) ??
    (field === 'stop'
      ? rideEdit
        ? (edit.stops[stopIndex] ?? edit.stops[edit.stops.length - 1] ?? null)
        : (draft.stops[stopIndex] ?? draft.dropoff)
      : null) ??
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
    // the driver gets a readable address or none (the pin and the landmark carry it), never
    // coordinates
    if (field === 'pickup') {
      choosePickup({ ...point, address });
      router.dismiss(2);
      return;
    }
    if (field === 'stop') {
      // past the search, back to the order sheet (or the ride's stops screen)
      if (rideEdit) setEditStop(stopIndex, { ...point, address });
      else setStop(stopIndex, { ...point, address });
      router.dismiss(2);
      return;
    }
    updateDraft({ dropoff: { ...point, address } });
    router.replace(orderPath(getDraft().service));
  };

  const title = save
    ? saveTitle(save)
    : field === 'pickup'
      ? t('home.points.pickup')
      : field === 'stop'
        ? t('home.search.stopTitle', { n: stopIndex + 1 })
        : t('home.points.dropoff');

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title }} />
      <PointPicker
        initial={start}
        onChange={(lat, lng) => void onChange(lat, lng)}
        onMoveStart={() => setBusy(true)}
        // the panel (title, 3-line address, button) keeps ~300 dp: in landscape or at a large
        // font the map gives way instead of pushing "Tayyor" off the screen
        height={Math.max(160, Math.min(height * 0.62, height - 300 - insets.bottom))}
      />
      <View style={[styles.panel, { paddingBottom: insets.bottom + space(4) }]}>
        <T variant="caption" color={colors.textMuted}>
          {field === 'pickup'
            ? t('home.fromCaption')
            : field === 'stop'
              ? t('home.pickOnMap.stopCaption')
              : t('home.pickOnMap.toCaption')}
        </T>
        <T variant="h3" numberOfLines={3}>
          {busy ? t('home.addressLookingUp') : (address ?? coordinatesLabel(point.lat, point.lng))}
        </T>
        <Button
          title={save ? t('common.actions.save') : t('common.actions.done')}
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
