import { useIsFocused } from 'expo-router';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useGeoConfig } from '../api/queries';
import type { TrackPoint } from '../api/realtime-logic';
import type { LatLng } from '../api/types';
import {
  glideAt,
  type GlidePlan,
  headingFor,
  type LatLngPoint,
  normaliseDeg,
  planGlide,
} from '../lib/car-motion';
import { useAppActive, useSettledTracking } from '../lib/use-app-active';
import { NATIVE_MAP, RideMapFallback } from '../location/MapFallback';
import { Attribution, mapTypeFor, TileLayer } from '../location/map-layers';
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
/** The camera follows the car at most this often (every fix would keep it swinging). */
const REFRAME_EVERY_MS = 10_000;
/** The car's glide is drawn at about 25 frames a second: smooth, and light on old phones. */
const FRAME_MS = 40;

const toCoord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });

/**
 * The ride's map: pickup and destination pins and the car, which glides between the GPS
 * fixes the stream delivers, turned the way it drives. Only the car's marker re-renders
 * while it glides; the map itself re-renders on a new fix at most. The camera follows the
 * car until the rider moves the map.
 */
export const RideMap = memo(function RideMap(props: RideMapProps) {
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
});

function NativeRideMap({ pickup, dropoff, car, trail, heading, bottomInset }: RideMapProps) {
  const map = useRef<MapView>(null);
  const config = useGeoConfig().data;
  const touchedAt = useRef(0);
  const framed = useRef<{ at: number; heading: RideMapProps['heading']; inset: number } | null>(
    null,
  );
  // the blue "you are here" dot keeps the GPS on: only while this screen is seen
  const focused = useIsFocused();
  const active = useAppActive();

  const points: LatLng[] = [];
  if (heading === 'pickup') points.push(pickup);
  else if (heading === 'dropoff') points.push(dropoff);
  else points.push(pickup, dropoff);
  if (car && heading) points.push(car);
  // ~10 m steps: GPS jitter of a waiting car does not move the camera
  const frameKey = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';');

  useEffect(() => {
    const now = Date.now();
    if (now - touchedAt.current < HANDS_OFF_MS) return;
    const last = framed.current;
    const changed = !last || last.heading !== heading || Math.abs(last.inset - bottomInset) > 24;
    if (!changed && now - last.at < REFRAME_EVERY_MS) return;
    framed.current = { at: now, heading, inset: bottomInset };
    const coords = frameKey.split(';').map((s) => {
      const [lat, lng] = s.split(',').map(Number);
      return { latitude: lat!, longitude: lng! };
    });
    if (coords.length === 1) {
      map.current?.animateCamera({ center: coords[0]!, zoom: 16 }, { duration: 500 });
      return;
    }
    map.current?.fitToCoordinates(coords, {
      edgePadding: { top: 120, right: 60, bottom: bottomInset + 40, left: 60 },
      animated: true,
    });
  }, [frameKey, heading, bottomInset]);

  // the line ends at the previous fix: the car glides from there towards the newest one
  const path = useMemo(() => trail.slice(0, -1).map(toCoord), [trail]);

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
        showsUserLocation={focused && active}
        showsMyLocationButton={false}
        onPanDrag={() => {
          touchedAt.current = Date.now();
        }}
      >
        <TileLayer config={config} />
        {path.length > 1 ? (
          <Polyline coordinates={path} strokeColor={colors.ink} strokeWidth={4} />
        ) : null}
        <PointMarker point={pickup} kind="pickup" />
        <PointMarker point={dropoff} kind="dropoff" />
        {car ? <CarMarker car={car} animate={focused && active} /> : null}
      </MapView>
      <Attribution config={config} />
    </View>
  );
}

const PointMarker = memo(
  function PointMarker({ point, kind }: { point: LatLng; kind: 'pickup' | 'dropoff' }) {
    const tracking = useSettledTracking();
    const pickup = kind === 'pickup';
    return (
      <Marker
        coordinate={toCoord(point)}
        tracksViewChanges={tracking}
        accessibilityLabel={pickup ? 'Olib ketish joyi' : 'Borish manzili'}
      >
        <View style={[styles.pin, { backgroundColor: pickup ? colors.brand : colors.ink }]}>
          <Icon
            name={pickup ? 'person' : 'flag'}
            size={16}
            color={pickup ? colors.ink : colors.onInk}
          />
        </View>
      </Marker>
    );
  },
  (a, b) => a.kind === b.kind && a.point.lat === b.point.lat && a.point.lng === b.point.lng,
);

interface Shown {
  point: LatLngPoint;
  rotation: number;
}

/**
 * The car: glides from where it is shown to each new fix over the time between fixes
 * (linear, like driving), turning the short way to its heading. Re-renders itself only.
 */
const CarMarker = memo(
  function CarMarker({ car, animate }: { car: TrackPoint; animate: boolean }) {
    const tracking = useSettledTracking();
    const [shown, setShown] = useState<Shown>(() => ({
      point: { lat: car.lat, lng: car.lng },
      rotation: car.heading ?? 0,
    }));
    const shownRef = useRef<Shown | null>(null);
    const prevFix = useRef<TrackPoint | null>(null);
    const headingRef = useRef<number | null>(car.heading);

    useEffect(() => {
      const fix: TrackPoint = { lat: car.lat, lng: car.lng, heading: car.heading, at: car.at };
      const heading = headingFor(prevFix.current, fix, headingRef.current);
      headingRef.current = heading;
      const plan: GlidePlan = planGlide(
        // not animating (background, another screen): the next fix lands in place
        animate ? shownRef.current : null,
        prevFix.current,
        fix,
        heading,
        Date.now(),
      );
      prevFix.current = fix;
      const show = (s: Shown) => {
        shownRef.current = s;
        setShown(s);
      };
      if (plan.durationMs <= 0) {
        show(glideAt(plan, Date.now()));
        return;
      }
      let frame = 0;
      let drawnAt = 0;
      const step = () => {
        const now = Date.now();
        const done = now - plan.startAt >= plan.durationMs;
        if (done || now - drawnAt >= FRAME_MS) {
          drawnAt = now;
          show(glideAt(plan, now));
        }
        if (!done) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      return () => cancelAnimationFrame(frame);
    }, [car.lat, car.lng, car.at, car.heading, animate]);

    return (
      <Marker
        coordinate={toCoord(shown.point)}
        anchor={{ x: 0.5, y: 0.5 }}
        rotation={normaliseDeg(shown.rotation)}
        flat
        tracksViewChanges={tracking}
        accessibilityLabel="Taksi"
      >
        <View style={styles.carWrap}>
          <View style={styles.carBody}>
            <View style={styles.carWindshield} />
            <View style={styles.carRear} />
          </View>
        </View>
      </Marker>
    );
  },
  (a, b) =>
    a.animate === b.animate &&
    a.car.lat === b.car.lat &&
    a.car.lng === b.car.lng &&
    a.car.at === b.car.at &&
    a.car.heading === b.car.heading,
);

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
  // a car seen from above, nose up (north at rotation 0): turned by the marker's rotation
  carWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  carBody: {
    width: 22,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.brand,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
  },
  carWindshield: {
    position: 'absolute',
    top: 8,
    width: 14,
    height: 7,
    borderRadius: 2,
    backgroundColor: colors.ink,
  },
  carRear: {
    position: 'absolute',
    bottom: 5,
    width: 12,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.ink,
  },
});
