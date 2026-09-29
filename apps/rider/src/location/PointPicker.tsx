import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';
import { useGeoConfig } from '../api/queries';
import { useAppActive } from '../lib/use-app-active';
import { Icon, IconButton } from '../ui/primitives';
import { colors, shadow, space } from '../ui/theme';
import { MaplessPicker, NATIVE_MAP } from './MapFallback';
import { Attribution, mapTypeFor, ServiceAreas, TileLayer } from './map-layers';
import { LocationNotice, useLocator } from './useLocator';

export interface PointPickerProps {
  initial: { lat: number; lng: number };
  /** Moves the map programmatically (e.g. a chosen search result); `key` repeats a move. */
  target?: { lat: number; lng: number; key: number } | null;
  /** Called when the map settles on a new centre (the pin's position). */
  onChange: (lat: number, lng: number) => void;
  /** Moving the map: lets the screen show that the address is being looked up. */
  onMoveStart?: () => void;
  height?: number;
}

const DELTA = 0.005;

/** Map with a fixed centre pin: the rider drags the map under the pin. */
export function PointPicker(props: PointPickerProps) {
  return NATIVE_MAP ? <NativePointPicker {...props} /> : <FallbackPointPicker {...props} />;
}

/** Without a native map (Android build without a Maps key): coordinates and my location. */
function FallbackPointPicker({ initial, target, onChange, height = 280 }: PointPickerProps) {
  const [found, setFound] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const locator = useLocator(({ fix }) =>
    setFound({ lat: fix.lat, lng: fix.lng, key: Date.now() }),
  );
  return (
    <View style={styles.fallback}>
      <LocationNotice
        problem={locator.problem}
        withMap={false}
        onSolve={() => void locator.solve()}
        onDismiss={locator.dismiss}
      />
      <MaplessPicker
        initial={initial}
        target={found && (!target || found.key > target.key) ? found : target}
        onChange={onChange}
        locating={locator.locating}
        height={height}
        onLocate={async () => {
          const r = await locator.locate('precise');
          return r ? { lat: r.fix.lat, lng: r.fix.lng } : null;
        }}
      />
    </View>
  );
}

function NativePointPicker({
  initial,
  target,
  onChange,
  onMoveStart,
  height = 280,
}: PointPickerProps) {
  const map = useRef<MapView>(null);
  const config = useGeoConfig().data;
  const [moving, setMoving] = useState(false);
  // the blue dot keeps the GPS on: only while this screen is seen and the app is open
  const focused = useIsFocused();
  const active = useAppActive();

  const moveTo = (lat: number, lng: number) =>
    map.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: DELTA, longitudeDelta: DELTA },
      400,
    );

  useEffect(() => {
    if (target) moveTo(target.lat, target.lng);
  }, [target]);

  const locator = useLocator(({ fix }) => moveTo(fix.lat, fix.lng));
  const locating = locator.locating;
  const locate = () => void locator.locateAndReport('precise');

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: initial.lat,
          longitude: initial.lng,
          latitudeDelta: DELTA,
          longitudeDelta: DELTA,
        }}
        mapType={mapTypeFor(config)}
        showsUserLocation={focused && active}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onRegionChange={() => {
          if (!moving) {
            setMoving(true);
            onMoveStart?.();
          }
        }}
        onRegionChangeComplete={(region: Region) => {
          setMoving(false);
          onChange(region.latitude, region.longitude);
        }}
      >
        <TileLayer config={config} />
        <ServiceAreas config={config} />
      </MapView>
      <View pointerEvents="none" style={styles.pinWrap}>
        <View style={[styles.pin, moving ? styles.pinLifted : null]}>
          <Icon name="location-sharp" size={44} color={colors.ink} />
        </View>
        <View style={styles.pinShadow} />
      </View>
      <Attribution config={config} />
      <View style={styles.notice}>
        <LocationNotice
          problem={locator.problem}
          withMap
          onSolve={() => void locator.solve()}
          onDismiss={locator.dismiss}
        />
      </View>
      <View style={styles.locate}>
        {locating ? (
          <View style={styles.locateSpinner}>
            <ActivityIndicator color={colors.ink} />
          </View>
        ) : (
          <IconButton
            name="navigate"
            label="Mening joylashuvim"
            size={48}
            color={colors.ink}
            onPress={locate}
            style={shadow.card}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: colors.surface },
  pinWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // the pin's tip sits on the map centre
  pin: { marginBottom: 44 },
  pinLifted: { transform: [{ translateY: -8 }] },
  pinShadow: {
    position: 'absolute',
    width: 10,
    height: 4,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  fallback: { gap: space(3) },
  notice: { position: 'absolute', top: space(3), left: space(3), right: space(3) },
  locate: { position: 'absolute', right: space(4), bottom: space(4) },
  locateSpinner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
});
