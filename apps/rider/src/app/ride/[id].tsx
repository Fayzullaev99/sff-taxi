import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { clearTrack, useCarTrack, useLiveDestinationEta, useLiveEta } from '../../api/live-track';
import { keys, useRide } from '../../api/queries';
import { useLiveRides } from '../../api/realtime';
import { carPosition, mergeTrail, type TrackPoint } from '../../api/realtime-logic';
import type { Ride, SosResult } from '../../api/types';
import { confirm, notify } from '../../lib/dialogs';
import {
  cashToPay,
  OWED_FEE_LABEL,
  type RideRules,
  rideRules,
  waitingRuleText,
  waitingState,
} from '../../lib/fare';
import {
  formatClock,
  formatDateTime,
  formatMinutes,
  formatMoney,
  formatTime,
  placeLine,
} from '../../lib/format';
import { type EtaDisplay, fixIsStale, steadyEta } from '../../lib/car-motion';
import { useNow } from '../../lib/hooks';
import { shareText } from '../../lib/links';
import { newerEta, pickupEta, type RideScreen, rideScreen } from '../../lib/ride-state';
import { searchStartsAt } from '../../lib/schedule';
import { CancelSheet } from '../../ride/CancelSheet';
import { PaymentPanel } from '../../ride/PaymentPanel';
import { RideSummary } from '../../ride/RideSummary';
import { KeyboardAvoider } from '../../ui/KeyboardAvoider';
import { SosSheet } from '../../ride/SosSheet';
import { markRideShown } from '../../trip/shown-rides';
import { DriverCard } from '../../ui/DriverCard';
import { Banner, Button, Icon, IconButton, T } from '../../ui/primitives';
import { SearchPulse } from '../../ui/Pulse';
import { RideMap } from '../../ui/RideMap';
import { useOnline } from '../../ui/OfflineBanner';
import { ErrorView, LoadingView } from '../../ui/states';
import { colors, radius, shadow, space } from '../../ui/theme';

/**
 * One ride from order to the end: a card ride's payment (Payme/Click, 10 minutes) or a
 * ride for later waiting for its time -> searching (cancel free) -> the car on its way
 * (driver, car and plate, live position and road ETA) -> waiting at the pickup (free
 * minutes, then paid, by the ride's own rules) -> on the trip (share link, SOS) -> the
 * summary with the fare, the receipt, the rating and complaints.
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
  // a cancelled card ride's refund is still on its way: keep listening for ride.refund
  const refundPending = ride?.paymentStatus === 'refund_pending';

  useEffect(() => {
    if (id) markRideShown(id);
  }, [id]);

  useEffect(() => {
    if (final === undefined) return;
    setStreamWanted(!final || refundPending);
    if (final && id) {
      clearTrack(id);
      void queryClient.invalidateQueries({ queryKey: keys.currentRide });
      void queryClient.invalidateQueries({ queryKey: keys.scheduled });
    }
  }, [final, refundPending, id, queryClient]);

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
      // the rating comment sits at the bottom of the summary
      <KeyboardAvoider style={styles.root}>
        <TopBar ride={ride} />
        <RideSummary ride={ride} />
      </KeyboardAvoider>
    );
  }

  return (
    <LiveRide
      ride={ride}
      screen={screen!}
      updatedAt={query.dataUpdatedAt}
      onCheck={() => query.refetch()}
    />
  );
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

function LiveRide({
  ride,
  screen,
  updatedAt,
  onCheck,
}: {
  ride: Ride;
  screen: RideScreen;
  /** When the ride was last fetched (a cold start offline shows the one kept on the phone). */
  updatedAt: number;
  onCheck: () => Promise<unknown>;
}) {
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const queryClient = useQueryClient();
  const live = useCarTrack(ride.id);
  // the API's trail since the assignment, continued by the fixes streamed since
  const track = useMemo(() => mergeTrail(ride.trail, live), [ride.trail, live]);
  const driverLocation = ride.driver?.location ?? null;
  // the same object while nothing moved: the memoised map is not re-rendered for nothing
  const car = useMemo(
    () => (screen.showDriver ? carPosition(track, driverLocation) : null),
    [screen.showDriver, track, driverLocation],
  );
  const rules = rideRules(ride);
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
      void queryClient.invalidateQueries({ queryKey: keys.scheduled });
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

  const noMap =
    screen.phase === 'searching' ||
    screen.phase === 'awaiting_payment' ||
    screen.phase === 'scheduled';

  return (
    <View style={styles.root}>
      {noMap ? (
        <View style={[styles.searchBg, { paddingBottom: panelHeight }]}>
          {screen.phase === 'searching' ? (
            <SearchPulse />
          ) : (
            <View style={styles.bigIcon}>
              <Icon
                name={screen.phase === 'scheduled' ? 'calendar' : 'card'}
                size={44}
                color={colors.ink}
              />
            </View>
          )}
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

          {!online && updatedAt ? (
            <T variant="small" color={colors.textMuted}>
              Internet yo‘q: {formatTime(new Date(updatedAt).toISOString())} holatidagi ma’lumot
              ko‘rsatilmoqda.
            </T>
          ) : null}

          {screen.phase === 'awaiting_payment' ? (
            <PaymentPanel ride={ride} onCheck={onCheck} />
          ) : null}

          {screen.phase === 'scheduled' ? <ScheduledInfo ride={ride} rules={rules} /> : null}

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

          {rules && (screen.phase === 'assigned' || screen.phase === 'arrived') ? (
            <T variant="small" color={colors.textMuted}>
              {waitingRuleText(rules)}
            </T>
          ) : null}

          {screen.canCancel ? (
            <Button
              title={
                screen.phase === 'scheduled'
                  ? 'Oldindan buyurtmani bekor qilish'
                  : 'Buyurtmani bekor qilish'
              }
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
  const now = useNow(15_000);
  const liveEta = useLiveEta(ride.id);
  const liveDestinationEta = useLiveDestinationEta(ride.id);
  // the API's road ETA (fetched or streamed, whichever is newer); the estimate only without
  const rawEta =
    screen.phase === 'assigned'
      ? (pickupEta(newerEta(ride.driverEta, liveEta), car, ride.pickup, now)?.minutes ?? null)
      : screen.phase === 'on_trip'
        ? (pickupEta(
            newerEta(ride.destinationEta ?? null, liveDestinationEta),
            car,
            ride.dropoff,
            now,
          )?.minutes ?? null)
        : null;
  const eta = useSteadyEta(rawEta, screen.phase);
  const carSilent =
    (screen.phase === 'assigned' || screen.phase === 'on_trip') &&
    fixIsStale(car?.at, now.getTime());
  let line: string | null = null;
  if (screen.phase === 'assigned') {
    line = eta ? `Taxminan ${formatMinutes(eta)}da yetib keladi` : 'Haydovchi yo‘lga chiqdi';
  } else if (screen.phase === 'on_trip') {
    line = `${placeLine(ride.dropoff)}${eta ? ` · ~${formatMinutes(eta)}` : ''}`;
  } else if (screen.phase === 'scheduled' && ride.scheduledFor) {
    line = `${formatDateTime(ride.scheduledFor)} ga`;
  }
  return (
    <View style={styles.header}>
      <T variant="h2" accessibilityRole="header" accessibilityLiveRegion="polite">
        {screen.title}
      </T>
      {line ? (
        <T
          variant={screen.phase === 'assigned' ? 'bodyStrong' : 'body'}
          color={screen.phase === 'assigned' ? colors.text : colors.textMuted}
          numberOfLines={2}
        >
          {line}
        </T>
      ) : null}
      {carSilent ? (
        <T variant="small" color={colors.warning}>
          Mashina joylashuvi yangilanmayapti — aloqa kutilmoqda…
        </T>
      ) : null}
      {screen.phase === 'arrived' ? <WaitingClock ride={ride} rules={rules} /> : null}
      {screen.phase === 'on_trip' || screen.phase === 'assigned' ? <FareLine ride={ride} /> : null}
    </View>
  );
}

/**
 * The ETA in minutes without flicker: a drop shows at once, a one-minute rise only once it
 * held for 30 s (see steadyEta). Starts over when the phase changes.
 */
function useSteadyEta(minutes: number | null, phase: string): number | null {
  const state = useRef<{ phase: string; eta: EtaDisplay }>({
    phase,
    eta: { shown: null, higherSince: null },
  });
  if (state.current.phase !== phase) {
    state.current = { phase, eta: { shown: null, higherSince: null } };
  }
  state.current.eta = steadyEta(state.current.eta, minutes, Date.now());
  return state.current.eta.shown;
}

/**
 * The price on the way and on the trip. A cash ride that also collects fees owed from
 * earlier cancelled rides says the total to hand over and what the extra is.
 */
function FareLine({ ride }: { ride: Ride }) {
  const cash = cashToPay(ride);
  if (cash.owedFee <= 0) {
    return (
      <T variant="smallStrong">
        {formatMoney(ride.fare.quoted)} ·{' '}
        {ride.paymentMethod === 'cash' ? 'naqd' : 'karta orqali to‘langan'} · narx o‘zgarmaydi
      </T>
    );
  }
  return (
    <View style={styles.owed}>
      <T variant="smallStrong">
        Naqd: {formatMoney(ride.fare.quoted + cash.owedFee)} · narx o‘zgarmaydi
      </T>
      <T variant="small" color={colors.textMuted}>
        Safar {formatMoney(ride.fare.quoted)} + {OWED_FEE_LABEL.toLowerCase()}{' '}
        {formatMoney(cash.owedFee)} (bekor qilish to‘lovi)
      </T>
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

function RouteBox({ ride }: { ride: Ride }) {
  return (
    <View accessible style={styles.routeBox}>
      <T variant="small" color={colors.textMuted} numberOfLines={1}>
        {placeLine(ride.pickup)}
      </T>
      <Icon name="arrow-down" size={14} color={colors.textMuted} />
      <T variant="small" color={colors.textMuted} numberOfLines={1}>
        {placeLine(ride.dropoff)}
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
      <RouteBox ride={ride} />
      <FareLine ride={ride} />
      {elapsed > 180 ? (
        <Banner
          tone="info"
          message="Qidiruv odatdagidan uzoq davom etmoqda. Operatorlar ham buyurtmangizni ko‘rib turibdi."
        />
      ) : null}
    </View>
  );
}

/** A ride for later: when, where, the fixed price; the search starts 15 minutes before. */
function ScheduledInfo({ ride, rules }: { ride: Ride; rules: RideRules | null }) {
  return (
    <View style={styles.searchInfo}>
      <RouteBox ride={ride} />
      <FareLine ride={ride} />
      {ride.scheduledFor ? (
        <Banner
          tone="info"
          icon="notifications-outline"
          message={`Haydovchi qidiruvi soat ${formatTime(searchStartsAt(ride.scheduledFor))} da boshlanadi. Mashina topilganda xabar beramiz.`}
        />
      ) : null}
      {rules ? (
        <T variant="small" color={colors.textMuted}>
          {waitingRuleText(rules)} Oldindan buyurtmani bekor qilish bepul.
        </T>
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
  bigIcon: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
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
  owed: { gap: 2 },
  routeBox: { gap: 2 },
});
