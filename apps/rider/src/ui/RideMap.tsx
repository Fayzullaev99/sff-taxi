import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useGeoConfig } from '../api/queries';
import type { TrackPoint } from '../api/realtime-logic';
import type { LatLng } from '../api/types';
import { NATIVE_MAP, RideMapFallback } from '../location/MapFallback';
import { Attribution, mapTypeFor, TileLayer } from '../location/map-layers';
import { useGlidingPoint } from '../lib/motion';
import { Icon } from './primitives';
import { colors } from './theme';

export interface RideMapProps {
  pickup: LatLng;
  dropoff: LatLng;
  car: TrackPoint | null;
  trail: TrackPoint[];
  /** Frame the car with the pickup (on the way) or the destination (on the trip). */
  heading: 'pickup' | 'dropoff' | null;
  /** Space the bottom panel covers, so framing keeps the points visible above it. */
  bottomInset: number;
}

/** After the rider pans or zooms, leave the camera alone for this long. */
const HANDS_OFF_MS = 20_000;

const toCoord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });

/**
 * The ride's map: pickup and destination pins and the car, which glides between the
 * GPS fixes the stream delivers. The camera follows the car until the rider moves the
 * map. Markers are static views (tracksViewChanges off): cheap on low-end Android.
 */
export function RideMap(props: RideMapProps) {
  if (NATIVE_MAP) return <NativeRideMap {...props} />;
  const { car, heading, pickup, dropoff, bottomInset } = props;
  return (
    <RideMapFallback
      car={car}
      target={heading === 'dropoff' ? dropoff : pickup}
      heading={heading}
      bottomInset={bottomInset}
    />
  );
}

function NativeRideMap({ pickup, dropoff, car, trail, heading, bottomInset }: RideMapProps) {
  const map = useRef<MapView>(null);
  const config = useGeoConfig().data;
  const shown = useGlidingPoint(car);
  const touchedAt = useRef(0);

  const points: LatLng[] = [];
  if (heading === 'pickup') points.push(pickup);
  else if (heading === 'dropoff') points.push(dropoff);
  else points.push(pickup, dropoff);
  if (car && heading) points.push(car);
  // re-frame on real fixes (~every 3-5 s) and phase changes, not on every render
  const frameKey = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
  const frame = useMemo(
    () =>
      frameKey.split(';').map((s) => {
        const [lat, lng] = s.split(',').map(Number);
        return { lat: lat!, lng: lng! };
      }),
    [frameKey],
  );

  useEffect(() => {
    if (Date.now() - touchedAt.current < HANDS_OFF_MS) return;
    const coords = frame.map(toCoord);
    if (coords.length === 1) {
      map.current?.animateCamera({ center: coords[0]!, zoom: 16 }, { duration: 500 });
      return;
    }
    map.current?.fitToCoordinates(coords, {
      edgePadding: { top: 120, right: 60, bottom: bottomInset + 40, left: 60 },
      animated: true,
    });
  }, [frame, bottomInset]);

  const path = trail.map(toCoord);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: pickup.lat,
          longitude: pickup.lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        mapType={mapTypeFor(config)}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsUserLocation
        showsMyLocationButton={false}
        onPanDrag={() => {
          touchedAt.current = Date.now();
        }}
      >
        <TileLayer config={config} />
        {path.length > 1 ? (
          <Polyline coordinates={path} strokeColor={colors.ink} strokeWidth={4} />
        ) : null}
        <Marker
          coordinate={toCoord(pickup)}
          tracksViewChanges={false}
          accessibilityLabel="Olib ketish joyi"
        >
          <View style={[styles.pin, { backgroundColor: colors.brand }]}>
            <Icon name="person" size={16} color={colors.ink} />
          </View>
        </Marker>
        <Marker
          coordinate={toCoord(dropoff)}
          tracksViewChanges={false}
          accessibilityLabel="Borish manzili"
        >
          <View style={[styles.pin, { backgroundColor: colors.ink }]}>
            <Icon name="flag" size={16} color={colors.onInk} />
          </View>
        </Marker>
        {shown ? (
          <Marker
            coordinate={toCoord(shown)}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            accessibilityLabel="Taksi"
          >
            <View style={styles.car}>
              <Icon name="car-sport" size={20} color={colors.ink} />
            </View>
          </Marker>
        ) : null}
      </MapView>
      <Attribution config={config} />
    </View>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  car: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: colors.ink,
  },
});
