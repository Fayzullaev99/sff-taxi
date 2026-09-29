import Constants from 'expo-constants';
import type { RideService } from '../api/types';
import { carAwayLabel } from '../lib/services';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { canShowNativeMap, parseCoordinate } from '../lib/map-support';
import { formatDistance } from '../lib/format';
import { distanceM } from '../lib/ride-state';
import type { LatLng } from '../api/types';
import { Button, Icon, T, TextField } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';

/**
 * Whether this build can draw a native map. An Android build without a Google Maps key
 * would crash on the first MapView ("API key not found"), so the screens fall back to the
 * map-less views below.
 */
export const NATIVE_MAP = canShowNativeMap(
  Platform.OS,
  Constants.expoConfig?.extra as Record<string, unknown> | undefined,
);

const fixed = (n: number) => n.toFixed(5);

/**
 * Stands in for the home map: says where the pickup is (coordinates) and that it is set
 * with "my location", the search or "choose on the map" (the map-less picker).
 */
export function HomeMapFallback({ point, top }: { point: LatLng | null; top: number }) {
  return (
    <View style={[styles.fill, { paddingTop: top + space(16) }]}>
      <View style={styles.badge}>
        <Icon name="map-outline" size={40} color={colors.ink} />
      </View>
      <T variant="h3" style={styles.center}>
        Xarita bu qurilmada ko‘rsatilmaydi
      </T>
      <T variant="small" color={colors.textMuted} style={styles.center}>
        Olib ketish joyini «Mening joylashuvim» tugmasi yoki «Qayerdan» qatoridagi qidiruv bilan
        belgilang.
      </T>
      {point ? (
        <T variant="caption" color={colors.textMuted} style={styles.center}>
          {fixed(point.lat)}, {fixed(point.lng)}
        </T>
      ) : null}
    </View>
  );
}

/**
 * The point picker without a map: the point's coordinates (editable) and a "my location"
 * button. The initial point counts as chosen, like a map settling on its first region.
 */
export function MaplessPicker({
  initial,
  target,
  onChange,
  onLocate,
  locating,
  height,
}: {
  initial: LatLng;
  target?: { lat: number; lng: number; key: number } | null;
  onChange: (lat: number, lng: number) => void;
  onLocate: () => Promise<LatLng | null>;
  locating: boolean;
  height: number;
}) {
  const [lat, setLat] = useState(fixed(initial.lat));
  const [lng, setLng] = useState(fixed(initial.lng));
  const report = useRef(onChange);
  report.current = onChange;

  const apply = (p: LatLng) => {
    setLat(fixed(p.lat));
    setLng(fixed(p.lng));
    report.current(p.lat, p.lng);
  };

  // like a map's first settled region
  useEffect(() => {
    report.current(initial.lat, initial.lng);
  }, []);

  useEffect(() => {
    if (target) apply(target);
  }, [target]);

  // typed coordinates apply once both are valid and the typing paused
  useEffect(() => {
    const a = parseCoordinate(lat, 90);
    const b = parseCoordinate(lng, 180);
    if (a === null || b === null) return;
    const timer = setTimeout(() => report.current(a, b), 700);
    return () => clearTimeout(timer);
  }, [lat, lng]);

  const latBad = parseCoordinate(lat, 90) === null;
  const lngBad = parseCoordinate(lng, 180) === null;

  return (
    <View style={[styles.picker, { minHeight: height }]}>
      <View style={styles.row}>
        <Icon name="map-outline" size={22} color={colors.textMuted} />
        <T variant="small" color={colors.textMuted} style={styles.flex}>
          Xarita bu qurilmada ko‘rsatilmaydi: joylashuvingizni aniqlang yoki koordinatalarni
          kiriting.
        </T>
      </View>
      {locating ? (
        <View style={styles.locating}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : (
        <Button
          title="Mening joylashuvim"
          icon="navigate"
          variant="secondary"
          onPress={() => {
            void onLocate().then((p) => {
              if (p) apply(p);
            });
          }}
        />
      )}
      <View style={styles.row}>
        <TextField
          label="Kenglik"
          value={lat}
          onChangeText={setLat}
          keyboardType="decimal-pad"
          error={latBad ? 'Masalan, 40.49598' : null}
          style={styles.flex}
        />
        <TextField
          label="Uzunlik"
          value={lng}
          onChangeText={setLng}
          keyboardType="decimal-pad"
          error={lngBad ? 'Masalan, 68.77587' : null}
          style={styles.flex}
        />
      </View>
    </View>
  );
}

/**
 * Stands in for the ride map: how far the car is from the point it is heading to (the
 * panel below has the ETA, the driver and the plate).
 */
export function RideMapFallback({
  car,
  target,
  heading,
  bottomInset,
  service,
}: {
  car: LatLng | null;
  target: LatLng;
  heading: 'pickup' | 'dropoff' | null;
  bottomInset: number;
  service?: RideService;
}) {
  const away = car && heading ? distanceM(car, target) : null;
  return (
    <View style={[styles.fill, styles.rideFill, { paddingBottom: bottomInset }]}>
      <View style={styles.badge}>
        <Icon name="car-sport" size={40} color={colors.ink} />
      </View>
      {away !== null ? (
        <T variant="h3" style={styles.center}>
          {heading === 'pickup' ? carAwayLabel(service) : 'Manzilgacha'} {formatDistance(away)}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(8),
    backgroundColor: colors.brandSoft,
  },
  rideFill: { justifyContent: 'center' },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  picker: {
    padding: space(4),
    gap: space(3),
    backgroundColor: colors.brandSoft,
    borderRadius: radius.lg,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3) },
  flex: { flex: 1 },
  locating: { height: 48, alignItems: 'center', justifyContent: 'center' },
});
