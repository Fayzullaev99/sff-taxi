import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';
import { useGeoConfig } from '../api/queries';
import { notify } from '../lib/dialogs';
import { Icon, IconButton } from '../ui/primitives';
import { colors, shadow, space } from '../ui/theme';
import { locateDevice } from './geo';
import { MaplessPicker, NATIVE_MAP } from './MapFallback';
import { Attribution, mapTypeFor, ServiceAreas, TileLayer } from './map-layers';

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

function reportLocateFailure(reason: 'denied' | 'unavailable') {
  notify(
    reason === 'denied' ? 'Joylashuvga ruxsat berilmagan' : 'Joylashuv aniqlanmadi',
    reason === 'denied'
      ? 'Sozlamalarda ilovaga joylashuvdan foydalanishga ruxsat bering yoki xaritada belgilang.'
      : 'GPS yoqilganini tekshiring yoki manzilni xaritada belgilang.',
  );
}

/** Without a native map (Android build without a Maps key): coordinates and my location. */
function FallbackPointPicker({ initial, target, onChange, height = 280 }: PointPickerProps) {
  const [locating, setLocating] = useState(false);
  return (
    <MaplessPicker
      initial={initial}
      target={target}
      onChange={onChange}
      locating={locating}
      height={height}
      onLocate={async () => {
        setLocating(true);
        const result = await locateDevice(true);
        setLocating(false);
        if (!result.ok) {
          reportLocateFailure(result.reason);
          return null;
        }
        return { lat: result.lat, lng: result.lng };
      }}
    />
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
  const [locating, setLocating] = useState(false);
  const [moving, setMoving] = useState(false);

  const moveTo = (lat: number, lng: number) =>
    map.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: DELTA, longitudeDelta: DELTA },
      400,
    );

  useEffect(() => {
    if (target) moveTo(target.lat, target.lng);
  }, [target]);

  const locate = async () => {
    setLocating(true);
    const result = await locateDevice(true);
    setLocating(false);
    if (!result.ok) {
      reportLocateFailure(result.reason);
      return;
    }
    moveTo(result.lat, result.lng);
  };

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
        showsUserLocation
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
      <View style={styles.locate}>
        {locating ? (
          <View style={styles.locateSpinner}>
            <ActivityIndicator color={colors.ink} />
          </View>
        ) : (
          <IconButton
            name="navigate"
            label="Mening joylashuvim"
            size={46}
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
  locate: { position: 'absolute', right: space(4), bottom: space(4) },
  locateSpinner: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
});
