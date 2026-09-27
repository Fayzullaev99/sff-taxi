import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useCurrentRide,
  useGeoConfig,
  useMe,
  useResolve,
  useScheduledRides,
  useTariffAt,
} from '../api/queries';
import { useFeature } from '../api/support';
import type { LatLng } from '../api/types';
import { firstName, formatDateTime } from '../lib/format';
import { notify } from '../lib/dialogs';
import { SAVED_LABELS, type SavedKind, savedAddress } from '../lib/places';
import { isOpenStatus } from '../lib/ride-state';
import { DEFAULT_CENTER, describePoint, locateDevice } from '../location/geo';
import { Attribution, mapTypeFor, ServiceAreas, TileLayer } from '../location/map-layers';
import { areaNotice } from '../location/service-area';
import { updateDraft, useDraft } from '../trip/draft';
import { usePlaces } from '../trip/places-store';
import { markRideShown, wasRideShown } from '../trip/shown-rides';
import { Banner, Button, Chip, Icon, IconButton, T } from '../ui/primitives';
import { colors, radius, shadow, space } from '../ui/theme';

const DELTA = 0.006;

/**
 * The map: the pin in the middle is the pickup (the map moves under it), the address
 * under the pin is looked up as the map settles. "Qayerga?" opens the destination search.
 */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const config = useGeoConfig().data;
  const draft = useDraft();
  const places = usePlaces();
  const me = useMe().data;
  const current = useCurrentRide();
  const scheduled = useScheduledRides().data ?? [];
  const intercityOn = useFeature('intercity');
  const [moving, setMoving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const lookup = useRef(0);

  const pickup = draft.pickup;
  const pickupPoint: LatLng | null = pickup ? { lat: pickup.lat, lng: pickup.lng } : null;
  const tariff = useTariffAt(moving ? null : pickupPoint);
  const serviceable = tariff.data?.serviceable;
  const resolve = useResolve(pickupPoint, serviceable === false);

  // an open ride nobody looked at yet (app start, ordered by phone through the operator)
  // takes over once; after that the pill at the top leads back to it
  const openRide = current.data && isOpenStatus(current.data.status) ? current.data : null;
  const openRideId = openRide?.id;
  useEffect(() => {
    if (openRideId && !wasRideShown(openRideId)) {
      markRideShown(openRideId);
      router.push({ pathname: '/ride/[id]', params: { id: openRideId } });
    }
  }, [openRideId]);

  const moveTo = (lat: number, lng: number) =>
    map.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: DELTA, longitudeDelta: DELTA },
      400,
    );

  // a pickup chosen in the search: the map follows
  useEffect(() => {
    if (draft.moveMap) moveTo(draft.moveMap.lat, draft.moveMap.lng);
  }, [draft.moveMap]);

  // first open: centre on the rider (never overriding a pickup already chosen)
  const locatedOnce = useRef(false);
  useEffect(() => {
    if (locatedOnce.current || draft.pickup) return;
    locatedOnce.current = true;
    void locateDevice().then((r) => {
      if (r.ok) moveTo(r.lat, r.lng);
    });
  }, [draft.pickup]);

  const initial = pickup ?? config?.defaultCenter ?? DEFAULT_CENTER;

  const onSettled = async (lat: number, lng: number) => {
    setMoving(false);
    const same = pickup && Math.abs(pickup.lat - lat) < 1e-5 && Math.abs(pickup.lng - lng) < 1e-5;
    if (same && pickup.address) return;
    updateDraft({ pickup: { lat, lng, address: same ? pickup.address : null } });
    const ticket = ++lookup.current;
    setLookingUp(true);
    const info = await describePoint(lat, lng);
    if (ticket !== lookup.current) return;
    setLookingUp(false);
    updateDraft({ pickup: { lat, lng, address: info.address } });
  };

  const locate = async () => {
    setLocating(true);
    const result = await locateDevice();
    setLocating(false);
    if (!result.ok) {
      notify(
        result.reason === 'denied' ? 'Joylashuvga ruxsat berilmagan' : 'Joylashuv aniqlanmadi',
        result.reason === 'denied'
          ? 'Sozlamalarda ilovaga joylashuvdan foydalanishga ruxsat bering yoki pinni xaritada qo‘ying.'
          : 'GPS yoqilganini tekshiring yoki pinni xaritada qo‘ying.',
      );
      return;
    }
    moveTo(result.lat, result.lng);
  };

  const goSaved = (kind: SavedKind) => {
    const place = places[kind];
    if (!place) {
      router.push({ pathname: '/search', params: { field: 'dropoff', save: kind } });
      return;
    }
    updateDraft({ dropoff: { lat: place.lat, lng: place.lng, address: savedAddress(place) } });
    router.push('/order');
  };

  const notice = serviceable === false ? areaNotice(resolve.data) : null;
  const pickupText = moving
    ? 'Manzil aniqlanmoqda…'
    : (pickup?.address ?? (lookingUp ? 'Manzil aniqlanmoqda…' : 'Pin qo‘yilgan joy'));
  const name = firstName(me?.fullName);

  return (
    <View style={styles.root}>
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
        onMapReady={() => {
          // not every platform reports the first region: take the start point as the pickup
          if (!draft.pickup) void onSettled(initial.lat, initial.lng);
        }}
        onRegionChange={() => {
          if (!moving) setMoving(true);
        }}
        onRegionChangeComplete={(region: Region) => {
          void onSettled(region.latitude, region.longitude);
        }}
        accessibilityLabel="Xarita. Olib ketish joyini tanlash uchun xaritani suring."
      >
        <TileLayer config={config} />
        <ServiceAreas config={config} />
      </MapView>

      <View pointerEvents="none" style={styles.pinWrap}>
        <View style={[styles.pin, moving ? styles.pinLifted : null]}>
          <View style={styles.pinHead}>
            <Icon name="person" size={18} color={colors.ink} />
          </View>
          <View style={styles.pinStick} />
        </View>
        <View style={styles.pinShadow} />
      </View>

      <View style={[styles.top, { top: insets.top + space(2) }]}>
        <IconButton
          name="menu"
          label="Profil va sozlamalar"
          size={46}
          onPress={() => router.push('/profile')}
          style={shadow.card}
        />
        {openRide ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/ride/[id]', params: { id: openRide.id } })}
            style={[styles.activeRide, shadow.card]}
          >
            <Icon
              name={openRide.status === 'awaiting_payment' ? 'card' : 'car-sport'}
              size={18}
              color={colors.ink}
            />
            <T variant="smallStrong" numberOfLines={1} style={styles.flex}>
              {openRide.status === 'awaiting_payment' ? 'To‘lov kutilmoqda' : 'Faol safaringiz bor'}
            </T>
            <Icon name="chevron-forward" size={18} color={colors.ink} />
          </Pressable>
        ) : scheduled[0]?.scheduledFor ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Oldindan buyurtmalar: ${scheduled.length} ta. Eng yaqini ${formatDateTime(scheduled[0].scheduledFor)}`}
            onPress={() => router.push('/scheduled')}
            style={[styles.activeRide, styles.laterRide, shadow.card]}
          >
            <Icon name="calendar-outline" size={18} color={colors.ink} />
            <T variant="smallStrong" numberOfLines={1} style={styles.flex}>
              {formatDateTime(scheduled[0].scheduledFor)}
              {scheduled.length > 1 ? ` · +${scheduled.length - 1}` : ''}
            </T>
            <Icon name="chevron-forward" size={18} color={colors.ink} />
          </Pressable>
        ) : (
          <View style={styles.flex} />
        )}
        <IconButton
          name="time-outline"
          label="Safarlar tarixi"
          size={46}
          onPress={() => router.push('/history')}
          style={shadow.card}
        />
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + space(4) }, shadow.bar]}>
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
              onPress={locate}
              style={shadow.card}
            />
          )}
        </View>

        <T variant="h2" accessibilityRole="header" numberOfLines={2}>
          {name ? `Salom, ${name}!` : 'Qayerga boramiz?'}
        </T>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Qayerdan: ${pickupText}. O‘zgartirish`}
          onPress={() => router.push({ pathname: '/search', params: { field: 'pickup' } })}
          style={({ pressed }) => [styles.fromRow, pressed ? styles.pressed : null]}
        >
          <View style={[styles.dot, { backgroundColor: colors.brand }]} />
          <View style={styles.flex}>
            <T variant="caption" color={colors.textMuted}>
              QAYERDAN
            </T>
            <T variant="bodyStrong" numberOfLines={2}>
              {pickupText}
            </T>
          </View>
          <Icon name="search" size={18} color={colors.textMuted} />
        </Pressable>

        {notice ? <Banner tone="warning" title={notice.title} message={notice.message} /> : null}

        <Button
          title="Qayerga?"
          size="lg"
          icon="search"
          disabled={!pickup || moving || serviceable === false}
          onPress={() => router.push({ pathname: '/search', params: { field: 'dropoff' } })}
        />

        <View style={styles.chips}>
          {(['home', 'work'] as const).map((kind) => (
            <Chip
              key={kind}
              icon={kind === 'home' ? 'home-outline' : 'briefcase-outline'}
              label={places[kind] ? SAVED_LABELS[kind] : `${SAVED_LABELS[kind]} manzilini qo‘shish`}
              accessibilityLabel={
                places[kind]
                  ? `${SAVED_LABELS[kind]}ga borish: ${savedAddress(places[kind]!) ?? ''}`
                  : `${SAVED_LABELS[kind]} manzilini qo‘shish`
              }
              onPress={() => {
                if (!pickup || serviceable === false) return;
                goSaved(kind);
              }}
            />
          ))}
          {intercityOn ? (
            <Chip
              icon="bus-outline"
              label="Shaharlararo"
              accessibilityLabel="Shaharlararo qatnovlar: joy band qilish"
              onPress={() => router.push('/intercity')}
            />
          ) : null}
        </View>
      </View>
      <Attribution config={config} />
    </View>
  );
}

const PIN_HEAD = 36;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  pinWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    // the map centre is the middle of the screen; the panel covers the bottom, so the
    // pin is drawn where the centre is, whatever the panel's height
  },
  pin: { alignItems: 'center', marginBottom: PIN_HEAD + 14 },
  pinLifted: { transform: [{ translateY: -10 }] },
  pinHead: {
    width: PIN_HEAD,
    height: PIN_HEAD,
    borderRadius: PIN_HEAD / 2,
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinStick: { width: 3, height: 14, backgroundColor: colors.ink },
  pinShadow: {
    position: 'absolute',
    width: 10,
    height: 4,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  top: {
    position: 'absolute',
    left: space(4),
    right: space(4),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
  },
  activeRide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    minHeight: 46,
    paddingHorizontal: space(3.5),
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  laterRide: { backgroundColor: colors.bg },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space(4),
    paddingTop: space(4),
    gap: space(3),
  },
  locate: { position: 'absolute', right: space(4), top: -space(16) },
  locateSpinner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
    minHeight: 56,
  },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
});
