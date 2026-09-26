import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { clearTrack, useCarTrack } from '../../api/live-track';
import { keys, useRide } from '../../api/queries';
import { useLiveRides } from '../../api/realtime';
import { carPosition, type TrackPoint } from '../../api/realtime-logic';
import type { Ride, SosResult } from '../../api/types';
import { confirm, notify } from '../../lib/dialogs';
import { waitingState } from '../../lib/fare';
import { formatClock, formatMinutes, formatMoney, placeLine } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { shareText } from '../../lib/links';
import { etaMinutes, type RideScreen, rideScreen } from '../../lib/ride-state';
import { CancelSheet } from '../../ride/CancelSheet';
import { RideSummary } from '../../ride/RideSummary';
import { SosSheet } from '../../ride/SosSheet';
import { type RideRules, useRideRules } from '../../trip/ride-rules';
import { markRideShown } from '../../trip/shown-rides';
import { DriverCard } from '../../ui/DriverCard';
import { Banner, Button, Icon, IconButton, T } from '../../ui/primitives';
import { SearchPulse } from '../../ui/Pulse';
import { RideMap } from '../../ui/RideMap';
import { ErrorView, LoadingView } from '../../ui/states';
import { colors, radius, shadow, space } from '../../ui/theme';

/**
 * One ride from search to the end: searching (cancel free) -> the car on its way (driver,
 * car and plate, live position, ETA) -> waiting at the pickup (free minutes, then paid)
 * -> on the trip (share link, SOS) -> the summary with the fare and the rating.
 * Live: SSE nudges refetch the ride and move the car; a slow poll covers stream outages.
 */
export default function RideScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [streamWanted, setStreamWanted] = useState(true);
  const connected = useLiveRides(streamWanted);
  const query = useRide(id, connected);
  const ride = query.data;
  const screen = ride ? rideScreen(ride) : null;
  const final = screen?.final;

  useEffect(() => {
    if (id) markRideShown(id);
  }, [id]);

  useEffect(() => {
    if (final === undefined) return;
    setStreamWanted(!final);
    if (final && id) {
      clearTrack(id);
      void queryClient.invalidateQueries({ queryKey: keys.currentRide });
    }
  }, [final, id, queryClient]);

  if (!ride) {
    return (
      <View style={styles.root}>
        {query.isError ? (
          <ErrorView error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <LoadingView label="Safar yuklanmoqda…" />
        )}
      </View>
    );
  }

  if (screen!.final) {
    return (
      <View style={styles.root}>
        <TopBar ride={ride} />
        <RideSummary ride={ride} />
      </View>
    );
  }

  return <LiveRide ride={ride} screen={screen!} />;
}

function TopBar({ ride, overMap = false }: { ride: Ride; overMap?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.topBar,
        { paddingTop: insets.top + space(2) },
        overMap ? styles.topBarOverMap : null,
      ]}
      pointerEvents="box-none"
    >
      <IconButton
        name="arrow-back"
        label="Orqaga"
        size={46}
        // the order form was replaced by this screen: back leads to the map or the history
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
        style={overMap ? shadow.card : null}
      />
      <View style={[styles.number, overMap ? shadow.card : null]}>
        <T variant="smallStrong">#{ride.number}</T>
      </View>
    </View>
  );
}

function LiveRide({ ride, screen }: { ride: Ride; screen: RideScreen }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const queryClient = useQueryClient();
  const track = useCarTrack(ride.id);
  const car = screen.showDriver ? carPosition(track, ride.driver?.location ?? null) : null;
  const rules = useRideRules(ride);
  const [panelHeight, setPanelHeight] = useState(height * 0.45);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [sos, setSos] = useState<{
    open: boolean;
    sending: boolean;
    failed: boolean;
    result: SosResult | null;
  }>({ open: false, sending: false, failed: false, result: null });
  const [sharing, setSharing] = useState(false);

  const cancel = async (reason: string | null) => {
    setCancelBusy(true);
    setCancelError(null);
    try {
      const updated = await endpoints.cancel(ride.id, reason);
      queryClient.setQueryData(keys.ride(ride.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.currentRide });
      void queryClient.invalidateQueries({ queryKey: keys.history });
      setCancelOpen(false);
    } catch (e) {
      setCancelError(describeError(e));
      void queryClient.invalidateQueries({ queryKey: keys.ride(ride.id) });
    } finally {
      setCancelBusy(false);
    }
  };

  const share = async () => {
    setSharing(true);
    try {
      const link = await endpoints.share(ride.id);
      const plate = ride.vehicle ? ` (${ride.vehicle.plateFormatted})` : '';
      await shareText(`SFF Taxi: safarimni jonli kuzating${plate}`, link.url);
    } catch (e) {
      notify('Havola olinmadi', describeError(e));
    } finally {
      setSharing(false);
    }
  };

  const startSos = async () => {
    const ok = await confirm({
      title: 'SOS — favqulodda holat',
      message:
        'SFF Taxi operatorlariga signal va joylashuvingiz yuboriladi. Keyin 112/102/103 raqamlariga qo‘ng‘iroq qilishingiz mumkin.',
      confirmText: 'Signal yuborish',
      cancelText: 'Yo‘q',
      destructive: true,
    });
    if (!ok) return;
    setSos({ open: true, sending: true, failed: false, result: null });
    let position: { lat: number | null; lng: number | null } = { lat: null, lng: null };
    try {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
      if (last) position = { lat: last.coords.latitude, lng: last.coords.longitude };
    } catch {
      // no position: the operators still get the ride and the car's position
    }
    try {
      const result = await endpoints.sos(ride.id, { ...position, note: null });
      setSos({ open: true, sending: false, failed: false, result });
    } catch {
      setSos({ open: true, sending: false, failed: true, result: null });
    }
  };

  return (
    <View style={styles.root}>
      {screen.phase === 'searching' ? (
        <View style={[styles.searchBg, { paddingBottom: panelHeight }]}>
          <SearchPulse />
        </View>
      ) : (
        <RideMap
          pickup={ride.pickup}
          dropoff={ride.dropoff}
          car={car}
          trail={track}
          heading={screen.heading}
          bottomInset={panelHeight}
        />
      )}
      <TopBar ride={ride} overMap />

      <View
        style={[styles.panel, { maxHeight: height * 0.72 }, shadow.bar]}
        onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
      >
        <ScrollView
          contentContainerStyle={[styles.panelContent, { paddingBottom: insets.bottom + space(4) }]}
          bounces={false}
        >
          <PhaseHeader ride={ride} screen={screen} car={car} rules={rules} />

          {screen.showDriver ? <DriverCard driver={ride.driver} vehicle={ride.vehicle} /> : null}

          {screen.phase === 'searching' ? <SearchingInfo ride={ride} /> : null}

          {ride.pickup.landmark || ride.comment ? (
            <T variant="small" color={colors.textMuted} numberOfLines={3}>
              {[ride.pickup.landmark ? `Mo‘ljal: ${ride.pickup.landmark}` : null, ride.comment]
                .filter(Boolean)
                .join(' · ')}
            </T>
          ) : null}

          {screen.canShare || screen.canSos ? (
            <View style={styles.actions}>
              {screen.canShare ? (
                <Button
                  title="Safarni ulashish"
                  icon="share-social-outline"
                  variant="secondary"
                  loading={sharing}
                  onPress={() => void share()}
                  style={styles.flex}
                />
              ) : null}
              {screen.canSos ? (
                <Button
                  title="SOS"
                  icon="warning"
                  variant="sos"
                  onPress={() => void startSos()}
                  accessibilityLabel="SOS, favqulodda yordam"
                  style={styles.sos}
                />
              ) : null}
            </View>
          ) : null}

          {screen.canCancel ? (
            <Button
              title="Buyurtmani bekor qilish"
              variant="ghost"
              onPress={() => {
                setCancelError(null);
                setCancelOpen(true);
              }}
            />
          ) : null}
        </ScrollView>
      </View>

      <CancelSheet
        visible={cancelOpen}
        ride={ride}
        rules={rules}
        busy={cancelBusy}
        error={cancelError}
        onClose={() => setCancelOpen(false)}
        onConfirm={(reason) => void cancel(reason)}
      />
      <SosSheet
        visible={sos.open}
        onClose={() => setSos((s) => ({ ...s, open: false }))}
        result={sos.result}
        sending={sos.sending}
        failed={sos.failed}
      />
    </View>
  );
}

function PhaseHeader({
  ride,
  screen,
  car,
  rules,
}: {
  ride: Ride;
  screen: RideScreen;
  car: TrackPoint | null;
  rules: RideRules | null;
}) {
  let line: string | null = null;
  if (screen.phase === 'assigned') {
    const eta = etaMinutes(car, ride.pickup);
    line = eta ? `Taxminan ${formatMinutes(eta)}da yetib keladi` : 'Haydovchi yo‘lga chiqdi';
  } else if (screen.phase === 'on_trip') {
    const eta = etaMinutes(car, ride.dropoff);
    line = `${placeLine(ride.dropoff)}${eta ? ` · ~${formatMinutes(eta)}` : ''}`;
  }
  return (
    <View style={styles.header}>
      <T variant="h2" accessibilityRole="header" accessibilityLiveRegion="polite">
        {screen.title}
      </T>
      {line ? (
        <T variant="body" color={colors.textMuted} numberOfLines={2}>
          {line}
        </T>
      ) : null}
      {screen.phase === 'arrived' ? <WaitingClock ride={ride} rules={rules} /> : null}
      {screen.phase === 'on_trip' || screen.phase === 'assigned' ? (
        <T variant="smallStrong">
          {formatMoney(ride.fare.quoted)} · {ride.paymentMethod === 'cash' ? 'naqd' : 'karta'} ·
          narx o‘zgarmaydi
        </T>
      ) : null}
    </View>
  );
}

/** Free waiting counts down; after it, the paid minutes and their price count up. */
function WaitingClock({ ride, rules }: { ride: Ride; rules: RideRules | null }) {
  const now = useNow(1000);
  if (!ride.arrivedAt) return null;
  if (!rules) {
    return (
      <T variant="body" color={colors.textMuted}>
        Iltimos, chiqing — haydovchi kutmoqda.
      </T>
    );
  }
  const w = waitingState(ride.arrivedAt, rules.waiting, now);
  if (w.freeLeftS > 0) {
    return (
      <View style={[styles.clock, { backgroundColor: colors.successSoft }]}>
        <Icon name="time-outline" size={20} color={colors.success} />
        <T variant="bodyStrong" style={styles.flex}>
          Bepul kutish: {formatClock(w.freeLeftS)}
        </T>
      </View>
    );
  }
  return (
    <View style={[styles.clock, { backgroundColor: colors.warningSoft }]}>
      <Icon name="hourglass-outline" size={20} color={colors.warning} />
      <T variant="bodyStrong" style={styles.flex}>
        Pullik kutish: {w.paidMinutes} daq · {formatMoney(w.fee)}
      </T>
      <T variant="small" color={colors.textMuted}>
        {formatMoney(rules.waiting.per_minute)}/daq
      </T>
    </View>
  );
}

function SearchingInfo({ ride }: { ride: Ride }) {
  const now = useNow(1000);
  const elapsed = (now.getTime() - new Date(ride.requestedAt).getTime()) / 1000;
  return (
    <View style={styles.searchInfo}>
      <T variant="body" color={colors.textMuted}>
        Yaqin atrofdagi haydovchilarga taklif yuborilmoqda · {formatClock(elapsed)}
      </T>
      <View accessible style={styles.routeBox}>
        <T variant="small" color={colors.textMuted} numberOfLines={1}>
          {placeLine(ride.pickup)}
        </T>
        <Icon name="arrow-down" size={14} color={colors.textMuted} />
        <T variant="small" color={colors.textMuted} numberOfLines={1}>
          {placeLine(ride.dropoff)}
        </T>
      </View>
      <T variant="bodyStrong">{formatMoney(ride.fare.quoted)} · narx o‘zgarmaydi</T>
      {elapsed > 180 ? (
        <Banner
          tone="info"
          message="Qidiruv odatdagidan uzoq davom etmoqda. Operatorlar ham buyurtmangizni ko‘rib turibdi."
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  searchBg: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space(4),
    paddingBottom: space(2),
  },
  topBarOverMap: { position: 'absolute', top: 0, left: 0, right: 0 },
  number: {
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  panelContent: { padding: space(4), gap: space(3) },
  header: { gap: space(1.5) },
  clock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    padding: space(3),
    borderRadius: radius.md,
    marginTop: space(1),
  },
  actions: { flexDirection: 'row', gap: space(2.5) },
  sos: { minWidth: 96 },
  searchInfo: { gap: space(2) },
  routeBox: { gap: 2 },
});
