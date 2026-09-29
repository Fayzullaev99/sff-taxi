import { router, useFocusEffect, useIsFocused } from 'expo-router';
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useAppConfig,
  useCurrentRide,
  useGeoConfig,
  useMe,
  useResolve,
  useRouteFares,
  useScheduledRides,
  useTariffAt,
} from '../api/queries';
import { useFeature } from '../api/support';
import type { GeoConfig, LatLng } from '../api/types';
import { metresBetween } from '../lib/car-motion';
import { firstName, formatDateTime } from '../lib/format';
import {
  chipLabel,
  type Place,
  QUICK_RECENT,
  SAVED_LABELS,
  type SavedKind,
  savedAddress,
} from '../lib/places';
import { isOpenStatus } from '../lib/ride-state';
import { routeChips } from '../lib/sharing';
import { SERVICE_LABELS, serviceOn } from '../lib/services';
import type { RideService } from '../api/types';
import { useAppActive } from '../lib/use-app-active';
import { isGoodFix, MOVE_THRESHOLD_M, PRECISE } from '../location/fix';
import { DEFAULT_CENTER, describePoint, knownPoint } from '../location/geo';
import { HomeMapFallback, NATIVE_MAP } from '../location/MapFallback';
import { Attribution, mapTypeFor, ServiceAreas, TileLayer } from '../location/map-layers';
import { areaNotice } from '../location/service-area';
import { type Located, LocationNotice, useLocator } from '../location/useLocator';
import { getDraft, orderPath, updateDraft, useDraft } from '../trip/draft';
import { usePlaces } from '../trip/places-store';
import { markRideShown, wasRideShown } from '../trip/shown-rides';
import { Banner, Button, Chip, Icon, IconButton, T } from '../ui/primitives';
import { colors, radius, shadow, space } from '../ui/theme';

const DELTA = 0.006;
/** Back on the map after this long, a pickup that was found automatically is looked up again. */
const RELOCATE_AFTER_MS = 5 * 60_000;
/** The panel's height before it was measured (a typical phone). */
const PANEL_GUESS = 330;

/**
 * The map: the pin in the middle of the visible map is the pickup (the map moves under
 * it), found automatically — a quick rough position first, then a precise GPS fix — and
 * named as the map settles. One tap on home, work or a recent destination opens the price
 * screen with the class the rider used last: two taps to order.
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
  const features = useAppConfig().data?.features as Record<string, unknown> | undefined;
  const services = SERVICES.filter((sv) => serviceOn(sv, features));
  const service = services.includes(draft.service) ? draft.service : 'taxi';
  const focused = useIsFocused();
  const active = useAppActive();
  const [moving, setMoving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [panelHeight, setPanelHeight] = useState(PANEL_GUESS);
  /** How far off the pickup may be when only a vague position was found (metres). */
  const [vagueM, setVagueM] = useState<number | null>(null);
  const lookup = useRef(0);
  /** The rider moved the map or chose a pickup: automatic lookups do not move it any more. */
  const touched = useRef(false);
  /** When the pickup was last set by an automatic lookup (null: the rider chose it). */
  const autoAt = useRef<number | null>(null);
  const mapReady = useRef(false);
  const pendingMove = useRef<LatLng | null>(null);

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

  const onSettled = useCallback(async (lat: number, lng: number) => {
    setMoving(false);
    const now = getDraft().pickup;
    const same = now && Math.abs(now.lat - lat) < 1e-5 && Math.abs(now.lng - lng) < 1e-5;
    if (same && now.address) return;
    // an address already known for this spot (~10 m) shows at once
    const known = knownPoint(lat, lng);
    updateDraft({ pickup: { lat, lng, address: known?.address ?? (same ? now.address : null) } });
    if (known?.address) return;
    const ticket = ++lookup.current;
    setLookingUp(true);
    const info = await describePoint(lat, lng);
    if (ticket !== lookup.current) return;
    setLookingUp(false);
    updateDraft({ pickup: { lat, lng, address: info.address } });
  }, []);

  const moveTo = useCallback(
    (lat: number, lng: number) => {
      // without a map the point is taken as it is (no map to settle)
      if (!NATIVE_MAP) {
        void onSettled(lat, lng);
        return;
      }
      if (!mapReady.current) {
        pendingMove.current = { lat, lng };
        return;
      }
      map.current?.animateToRegion(
        { latitude: lat, longitude: lng, latitudeDelta: DELTA, longitudeDelta: DELTA },
        400,
      );
    },
    [onSettled],
  );

  const showFound = useCallback(
    ({ fix, precise }: Located) => {
      setVagueM(precise ? null : Math.round(fix.accuracyM ?? 0) || null);
      moveTo(fix.lat, fix.lng);
    },
    [moveTo],
  );

  // "my location" (and back from the settings): the rider asked, so the map always follows
  const locator = useLocator((found) => {
    touched.current = false;
    autoAt.current = null;
    showFound(found);
  });

  /**
   * The automatic lookup: a rough position at once (cached or network) so the map starts
   * near the rider, then a precise GPS fix that moves the pin if it is elsewhere — unless
   * the rider moved the map meanwhile.
   */
  const { locate } = locator;
  const autoLocate = useCallback(async () => {
    touched.current = false;
    const rough = await locate('rough', true);
    if (!rough || touched.current) return;
    autoAt.current = Date.now();
    showFound(rough);
    if (isGoodFix(rough.fix, Date.now(), PRECISE)) return;
    const precise = await locate('precise', false);
    if (!precise || touched.current) return;
    autoAt.current = Date.now();
    if (metresBetween(rough.fix, precise.fix) >= MOVE_THRESHOLD_M) showFound(precise);
    else setVagueM(precise.precise ? null : Math.round(precise.fix.accuracyM ?? 0) || null);
  }, [locate, showFound]);

  // first open: find the rider (never overriding a pickup already chosen)
  useEffect(() => {
    if (!getDraft().pickup) void autoLocate();
  }, []);

  // back on the map a while later (after a ride): the rider has probably moved
  useFocusEffect(
    useCallback(() => {
      const at = autoAt.current;
      if (at !== null && !touched.current && Date.now() - at > RELOCATE_AFTER_MS) {
        void autoLocate();
      }
    }, [autoLocate]),
  );

  // a pickup chosen in the search: the map follows, automatic lookups stop moving it
  useEffect(() => {
    if (!draft.moveMap) return;
    touched.current = true;
    autoAt.current = null;
    setVagueM(null);
    moveTo(draft.moveMap.lat, draft.moveMap.lng);
  }, [draft.moveMap, moveTo]);

  const [initial] = useState(() => pickup ?? config?.defaultCenter ?? DEFAULT_CENTER);

  // no map to report its first region: the start point is the pickup until located
  useEffect(() => {
    if (!NATIVE_MAP && !getDraft().pickup) void onSettled(initial.lat, initial.lng);
  }, []);

  const handlers = useRef({
    onReady: () => {},
    onMoveStart: () => {},
    onSettled: (_lat: number, _lng: number) => {},
    onDrag: () => {},
  });
  handlers.current = {
    onReady: () => {
      mapReady.current = true;
      const next = pendingMove.current;
      pendingMove.current = null;
      if (next) moveTo(next.lat, next.lng);
      // not every platform reports the first region: take the start point as the pickup
      else if (!getDraft().pickup) void onSettled(initial.lat, initial.lng);
    },
    onMoveStart: () => setMoving(true),
    onSettled: (lat, lng) => void onSettled(lat, lng),
    onDrag: () => {
      touched.current = true;
      autoAt.current = null;
      setVagueM(null);
    },
  };

  const goPlace = (place: { lat: number; lng: number; address: string | null }) => {
    updateDraft({ dropoff: place });
    router.push(orderPath(getDraft().service));
  };

  const goSaved = (kind: SavedKind) => {
    const place = places[kind];
    if (!place) {
      router.push({ pathname: '/search', params: { field: 'dropoff', save: kind } });
      return;
    }
    goPlace({ lat: place.lat, lng: place.lng, address: savedAddress(place) });
  };

  const goRecent = (p: Place) => goPlace({ lat: p.lat, lng: p.lng, address: p.title });

  const canOrder = Boolean(pickup) && !moving && serviceable !== false;
  const notice = serviceable === false ? areaNotice(resolve.data, NATIVE_MAP) : null;
  const pickupText = moving
    ? 'Manzil aniqlanmoqda…'
    : (pickup?.address ?? (lookingUp ? 'Manzil aniqlanmoqda…' : 'Pin qo‘yilgan joy'));
  const name = firstName(me?.fullName);
  const recent = places.recent.slice(0, QUICK_RECENT);
  // fixed prices from the rider's town to others ("Yangiyer → Guliston · 10 000/kishi"):
  // they work even where city rides have not started yet
  const routeFares = useRouteFares().data;
  const townLat = pickup ? pickup.lat.toFixed(2) : null;
  const townLng = pickup ? pickup.lng.toFixed(2) : null;
  const routes = useMemo(
    () =>
      routeChips(
        routeFares,
        townLat && townLng ? { lat: Number(townLat), lng: Number(townLng) } : null,
      ),
    [routeFares, townLat, townLng],
  );
  // the map fills the screen above the panel (tucked under its rounded top): the pin in
  // its middle is never hidden behind the panel, whatever the screen or font size
  const mapBottom = Math.max(0, panelHeight - radius.xl);

  return (
    <View style={styles.root}>
      {NATIVE_MAP ? null : <HomeMapFallback point={pickupPoint} top={insets.top} />}
      {!NATIVE_MAP ? null : (
        <View style={[styles.mapBox, { bottom: mapBottom }]}>
          <HomeMap
            mapRef={map}
            initial={initial}
            config={config}
            showsUser={focused && active}
            handlers={handlers}
          />
          <View pointerEvents="none" style={styles.pinWrap}>
            <View style={[styles.pin, moving ? styles.pinLifted : null]}>
              <View style={styles.pinHead}>
                <Icon name="person" size={18} color={colors.ink} />
              </View>
              <View style={styles.pinStick} />
            </View>
            <View style={styles.pinShadow} />
          </View>
          <Attribution config={config} />
        </View>
      )}

      <View style={[styles.top, { top: insets.top + space(2) }]}>
        <IconButton
          name="menu"
          label="Profil va sozlamalar"
          size={48}
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
          size={48}
          onPress={() => router.push('/history')}
          style={shadow.card}
        />
      </View>

      {/* above the panel, not inside it: Android delivers no touches outside a parent's bounds */}
      <View style={[styles.locate, { bottom: panelHeight + space(4) }]}>
        {locator.locating ? (
          <View style={styles.locateSpinner} accessibilityLabel="Joylashuv aniqlanmoqda">
            <ActivityIndicator color={colors.ink} />
          </View>
        ) : (
          <IconButton
            name="navigate"
            label="Mening joylashuvim"
            size={48}
            onPress={() => void locator.locateAndReport('precise')}
            style={shadow.card}
          />
        )}
      </View>

      <View
        style={[styles.panel, { paddingBottom: insets.bottom + space(4) }, shadow.bar]}
        onLayout={(e) => setPanelHeight(Math.round(e.nativeEvent.layout.height))}
      >
        {/* the service switch takes the greeting's place: the panel stays as tall */}
        {services.length <= 1 ? (
          <T variant="h2" accessibilityRole="header" numberOfLines={1}>
            {name ? `Salom, ${name}!` : 'Qayerga boramiz?'}
          </T>
        ) : (
          <ServiceSwitch
            services={services}
            value={service}
            onChange={(next) =>
              updateDraft(
                next === 'taxi'
                  ? { service: next }
                  : // cargo and parcels: no shared seat of a town route
                    { service: next, fareMode: 'car', shareable: false },
              )
            }
          />
        )}

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
            {vagueM && !moving ? (
              <T variant="small" color={colors.warning} numberOfLines={2}>
                Joylashuv taxminiy (±{vagueM} m) — pinni aniq joyga suring
              </T>
            ) : null}
          </View>
          <Icon name="search" size={18} color={colors.textMuted} />
        </Pressable>

        <LocationNotice
          problem={locator.problem}
          withMap={NATIVE_MAP}
          onSolve={() => void locator.solve()}
          onDismiss={locator.dismiss}
        />
        {notice ? <Banner tone="warning" title={notice.title} message={notice.message} /> : null}

        <Button
          title={WHERE_TO[service]}
          size="lg"
          icon="search"
          disabled={!canOrder}
          onPress={() => router.push({ pathname: '/search', params: { field: 'dropoff' } })}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chips}
          style={styles.chipsScroll}
        >
          {(['home', 'work'] as const).map((kind) => (
            <Chip
              key={kind}
              icon={places[kind] ? (kind === 'home' ? 'home-outline' : 'briefcase-outline') : 'add'}
              label={places[kind] ? SAVED_LABELS[kind] : `${SAVED_LABELS[kind]} qo‘shish`}
              accessibilityLabel={
                places[kind]
                  ? `${SAVED_LABELS[kind]}ga borish: ${savedAddress(places[kind]!) ?? ''}`
                  : `${SAVED_LABELS[kind]} manzilini qo‘shish`
              }
              onPress={() => {
                if (!canOrder && places[kind]) return;
                goSaved(kind);
              }}
            />
          ))}
          {recent.map((p) => (
            <Chip
              key={p.recentKey ?? `${p.lat},${p.lng}`}
              icon="time-outline"
              label={chipLabel(p.title)}
              accessibilityLabel={`Yana borish: ${p.title}`}
              onPress={() => {
                if (canOrder) goRecent(p);
              }}
            />
          ))}
          {(service === 'taxi' ? routes : []).map((r) => (
            <Chip
              key={r.key}
              icon="swap-horizontal"
              label={r.label}
              accessibilityLabel={`Belgilangan narx: ${r.label}`}
              onPress={() => {
                if (!pickup || moving) return;
                updateDraft({
                  dropoff: { lat: r.to.lat, lng: r.to.lng, address: r.to.name },
                  // a seat price: the order screen starts on a seat (shared, cash)
                  ...(r.seat ? { fareMode: 'seat' as const, paymentMethod: 'cash' as const } : {}),
                });
                router.push('/order');
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
        </ScrollView>
      </View>
    </View>
  );
}

const SERVICES: readonly RideService[] = ['taxi', 'cargo', 'delivery'];

const WHERE_TO: Record<RideService, string> = {
  taxi: 'Qayerga?',
  cargo: 'Yukni qayerga?',
  delivery: 'Posilkani qayerga?',
};

const SERVICE_ICONS = {
  taxi: 'car-sport-outline',
  cargo: 'cube-outline',
  delivery: 'mail-outline',
} as const;

/**
 * Taxi · Yuk · Yetkazish: one compact row over "Qayerga?". Taxi stays the default, so
 * the two-tap taxi order is untouched; the choice is remembered in the draft.
 */
function ServiceSwitch({
  services,
  value,
  onChange,
}: {
  services: readonly RideService[];
  value: RideService;
  onChange: (service: RideService) => void;
}) {
  return (
    <View style={styles.services} accessibilityRole="tablist">
      {services.map((sv) => {
        const on = sv === value;
        return (
          <Pressable
            key={sv}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={SERVICE_LABELS[sv]}
            onPress={() => onChange(sv)}
            style={[styles.service, on ? styles.serviceOn : null]}
          >
            <Icon name={SERVICE_ICONS[sv]} size={18} color={colors.ink} />
            <T variant="smallStrong" numberOfLines={1}>
              {SERVICE_LABELS[sv]}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

interface MapHandlers {
  onReady: () => void;
  onMoveStart: () => void;
  onSettled: (lat: number, lng: number) => void;
  onDrag: () => void;
}

/**
 * The map itself, memoised: the panel's state (address lookups, chips, the moving pin)
 * does not re-render the native map. Handlers are read through a ref.
 */
const HomeMap = memo(function HomeMap({
  mapRef,
  initial,
  config,
  showsUser,
  handlers,
}: {
  mapRef: RefObject<MapView | null>;
  initial: LatLng;
  config: GeoConfig | undefined;
  showsUser: boolean;
  handlers: RefObject<MapHandlers>;
}) {
  const moving = useRef(false);
  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={{
        latitude: initial.lat,
        longitude: initial.lng,
        latitudeDelta: DELTA,
        longitudeDelta: DELTA,
      }}
      mapType={mapTypeFor(config)}
      // the blue dot keeps the GPS on: only while the map is seen and the app is open
      showsUserLocation={showsUser}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      onMapReady={() => handlers.current.onReady()}
      onPanDrag={() => handlers.current.onDrag()}
      onRegionChange={() => {
        if (moving.current) return;
        moving.current = true;
        handlers.current.onMoveStart();
      }}
      onRegionChangeComplete={(region: Region) => {
        moving.current = false;
        handlers.current.onSettled(region.latitude, region.longitude);
      }}
      accessibilityLabel="Xarita. Olib ketish joyini tanlash uchun xaritani suring."
    >
      <TileLayer config={config} />
      <ServiceAreas config={config} />
    </MapView>
  );
});

const PIN_HEAD = 36;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  mapBox: { position: 'absolute', top: 0, left: 0, right: 0 },
  pinWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // the stick's tip sits on the map's centre
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
    minHeight: 48,
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
  locate: { position: 'absolute', right: space(4) },
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
  services: {
    flexDirection: 'row',
    gap: space(1),
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  service: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1.5),
    minHeight: 44,
    paddingHorizontal: space(2),
    borderRadius: radius.pill,
  },
  serviceOn: { backgroundColor: colors.brand },
  chipsScroll: { marginHorizontal: -space(4) },
  chips: { gap: space(2), paddingHorizontal: space(4) },
});
