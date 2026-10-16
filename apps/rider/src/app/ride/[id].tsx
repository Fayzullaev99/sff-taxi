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
import { useT } from '../../i18n';
import { confirm, notify } from '../../lib/dialogs';
import {
  cashToPay,
  waitingCashLine,
  owedFeeLabel,
  type RideRules,
  rideRules,
  stopStateText,
  waitingRuleText,
  waitingState,
} from '../../lib/fare';
import { passengerLine } from '../../lib/passenger';
import {
  formatClock,
  formatDateTime,
  formatMinutes,
  formatMoney,
  formatPhone,
  formatTime,
  placeLine,
} from '../../lib/format';
import { type EtaDisplay, fixIsStale, steadyEta } from '../../lib/car-motion';
import { useNow } from '../../lib/hooks';
import { freeCancelUntil } from '../../lib/deposit';
import { loadLine, serviceTitle } from '../../lib/services';
import { discountLine, occupancyText, pinDigits, ridePrice } from '../../lib/sharing';
import { discountSentence, rideDiscountLines } from '../../lib/promo';
import { SeatIcons } from '../../order/RideChoices';
import { shareText } from '../../lib/links';
import { etaFor, newerEta, pickupEta, type RideScreen, rideScreen } from '../../lib/ride-state';
import { searchStartsAt } from '../../lib/schedule';
import { tripTarget } from '../../lib/stops';
import { CancelSheet } from '../../ride/CancelSheet';
import { ChatButton } from '../../ride/ChatButton';
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
  const { t } = useT();
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
          <LoadingView label={t('ride.screen.loading')} />
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
  const { t } = useT();
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
        label={t('common.actions.back')}
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
  const { t } = useT();
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
      const plate = ride.vehicle?.plateFormatted;
      await shareText(
        plate ? t('ride.screen.shareTextPlate', { plate }) : t('ride.screen.shareText'),
        link.url,
      );
    } catch (e) {
      notify(t('ride.screen.shareFailed'), describeError(e));
    } finally {
      setSharing(false);
    }
  };

  const startSos = async () => {
    const ok = await confirm({
      title: t('ride.sos.confirmTitle'),
      message: t('ride.sos.confirmMessage'),
      confirmText: t('ride.sos.confirmSend'),
      cancelText: t('common.actions.no'),
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
  // the intermediate stops on the map (numbered, passed ones faded) and where the car goes
  const target = tripTarget(ride);
  const mapStops = useMemo(
    () =>
      (ride.stops ?? []).map((s, i) => ({
        lat: s.lat,
        lng: s.lng,
        passed: target.stopIndex === null ? Boolean(s.leftAt) : i < target.stopIndex,
      })),
    [ride.stops, target.stopIndex],
  );

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
          service={ride.service}
          stops={mapStops}
          nextStopIndex={target.stopIndex}
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
              {t('ride.screen.offlineAsOf', {
                time: formatTime(new Date(updatedAt).toISOString()),
              })}
            </T>
          ) : null}

          {screen.phase === 'awaiting_payment' ? (
            <PaymentPanel ride={ride} onCheck={onCheck} />
          ) : null}

          {screen.phase === 'scheduled' ? <ScheduledInfo ride={ride} rules={rules} /> : null}

          {(screen.phase === 'assigned' || screen.phase === 'arrived') &&
          pinDigits(ride.startPin) ? (
            <StartPin pin={ride.startPin!} />
          ) : null}

          {screen.showDriver ? <DriverCard driver={ride.driver} vehicle={ride.vehicle} /> : null}

          {screen.showDriver && ride.driver ? <ChatButton rideId={ride.id} /> : null}

          {screen.showDriver && ride.car && (ride.shareable || ride.car.riders > 1) ? (
            <View style={styles.occupancy} accessible>
              <SeatIcons car={ride.car} />
              <T variant="smallStrong" style={styles.flex}>
                {occupancyText(ride.car)}
                {ride.passengers && ride.passengers > 1
                  ? ` · ${t('ride.screen.yourParty', { count: ride.passengers })}`
                  : ''}
              </T>
            </View>
          ) : null}

          {screen.phase === 'searching' ? <SearchingInfo ride={ride} /> : null}

          {screen.phase !== 'searching' && screen.phase !== 'scheduled' ? (
            <StopsBox ride={ride} />
          ) : null}

          <LoadInfo ride={ride} />

          {ride.pickup.landmark || ride.comment ? (
            <T variant="small" color={colors.textMuted} numberOfLines={3}>
              {[
                ride.pickup.landmark
                  ? t('ride.screen.landmark', { landmark: ride.pickup.landmark })
                  : null,
                ride.comment,
              ]
                .filter(Boolean)
                .join(' · ')}
            </T>
          ) : null}

          {screen.canShare || screen.canSos ? (
            <View style={styles.actions}>
              {screen.canShare ? (
                <Button
                  title={t('ride.screen.share')}
                  icon="share-social-outline"
                  variant="secondary"
                  loading={sharing}
                  onPress={() => void share()}
                  style={styles.flex}
                />
              ) : null}
              {screen.canSos ? (
                <Button
                  title={t('ride.sos.button')}
                  icon="warning"
                  variant="sos"
                  onPress={() => void startSos()}
                  accessibilityLabel={t('ride.sos.buttonA11y')}
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
                  ? t('ride.cancel.buttonScheduled')
                  : t('ride.cancel.button')
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
  const { t } = useT();
  const now = useNow(15_000);
  const liveEta = useLiveEta(ride.id);
  const liveDestinationEta = useLiveDestinationEta(ride.id);
  // on the trip the car heads to the next intermediate stop, if any, else the drop-off
  const target = tripTarget(ride);
  // the API's road ETA (fetched or streamed, whichever is newer); the estimate only without
  const rawEta =
    screen.phase === 'assigned'
      ? (pickupEta(newerEta(ride.driverEta, liveEta), car, ride.pickup, now)?.minutes ?? null)
      : screen.phase === 'on_trip'
        ? (pickupEta(
            newerEta(
              etaFor(
                ride.destinationEta
                  ? { ...ride.destinationEta, stopIndex: ride.nextStopIndex ?? null }
                  : null,
                target.stopIndex,
              ),
              etaFor(liveDestinationEta, target.stopIndex),
            ),
            car,
            target.point,
            now,
          )?.minutes ?? null)
        : null;
  // the countdown starts over when the car drives on to the next stop
  const eta = useSteadyEta(rawEta, `${screen.phase}:${target.stopIndex ?? 'end'}`);
  const carSilent =
    (screen.phase === 'assigned' || screen.phase === 'on_trip') &&
    fixIsStale(car?.at, now.getTime());
  let line: string | null = null;
  if (screen.phase === 'assigned') {
    line = eta
      ? t('ride.screen.arrivesIn', { eta: formatMinutes(eta) })
      : t('ride.screen.driverLeft');
  } else if (screen.phase === 'on_trip') {
    const stop = target.stopIndex === null ? null : ride.stops?.[target.stopIndex];
    const standing = Boolean(stop?.arrivedAt && !stop.leftAt);
    const place =
      stop && target.stopIndex !== null
        ? t('ride.screen.nextStop', { n: target.stopIndex + 1, place: placeLine(stop) })
        : placeLine(ride.dropoff);
    line = standing
      ? `${place} · ${stopStateText(stop!)}`
      : `${place}${eta ? ` · ~${formatMinutes(eta)}` : ''}`;
  } else if (screen.phase === 'scheduled' && ride.scheduledFor) {
    line = t('ride.screen.scheduledAt', { when: formatDateTime(ride.scheduledFor) });
  }
  return (
    <View style={styles.header}>
      <T variant="h2" accessibilityRole="header" accessibilityLiveRegion="polite">
        {serviceTitle(ride.service, screen.phase, screen.title)}
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
          {t('ride.screen.carSilent')}
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
  const { t } = useT();
  const cash = cashToPay(ride);
  const waiting = waitingCashLine(ride);
  // a shared ride: the quoted price is the ceiling, co-riders lower it (live)
  const price = ridePrice(ride.fare);
  const cashRide = ride.paymentMethod === 'cash';
  // a promo code (or invitation) and ride credit: paid by the platform
  const promoLines = rideDiscountLines(ride.fare);
  return (
    <View style={styles.owed}>
      <View style={styles.priceRow}>
        {price.discount > 0 || promoLines.length ? (
          <T variant="smallStrong" color={colors.textMuted} style={styles.struck}>
            {formatMoney(price.quoted)}
          </T>
        ) : null}
        <T variant="smallStrong">
          {formatMoney(price.pays)} · {cashRide ? t('ride.fare.cash') : t('ride.fare.paidByCard')} ·{' '}
          {price.discount > 0 ? t('ride.fare.cheaperWithCoRider') : t('ride.fare.fixedPrice')}
        </T>
      </View>
      {promoLines.length ? (
        <T variant="small" color={colors.success}>
          {discountSentence(promoLines)}
        </T>
      ) : null}
      {price.discount > 0 ? (
        <T variant="small" color={colors.success}>
          {discountLine(price.discount)}
        </T>
      ) : ride.shareable && ride.fareMode !== 'seat' ? (
        <T variant="small" color={colors.textMuted}>
          {t('ride.fare.coRiderNote')}
        </T>
      ) : null}
      {price.deposit > 0 && cashRide ? (
        <T variant="small" color={colors.textMuted}>
          {t('ride.fare.depositLine', {
            deposit: formatMoney(price.deposit),
            rest: formatMoney(cash.fare),
          })}
        </T>
      ) : null}
      {waiting ? (
        <T variant="small" color={colors.textMuted}>
          {waiting}
        </T>
      ) : null}
      {cash.owedFee > 0 ? (
        <T variant="small" color={colors.textMuted}>
          {t('ride.fare.cashTotal', {
            total: formatMoney(cash.total),
            fare: formatMoney(cash.fare),
            owedLabel: owedFeeLabel().toLowerCase(),
            owed: formatMoney(cash.owedFee),
          })}
        </T>
      ) : null}
    </View>
  );
}

/**
 * The start code, big: the rider tells it to the driver, who starts the trip only with it
 * (at night, shared, a woman driver, between towns) — the right rider in the right car.
 */
function StartPin({ pin }: { pin: string }) {
  const { t } = useT();
  return (
    <View
      style={styles.pin}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('ride.screen.pinA11y', { digits: pin.split('').join(' ') })}
    >
      <Icon name="key-outline" size={22} color={colors.ink} />
      <View style={styles.flex}>
        <T variant="small" color={colors.textMuted}>
          {t('ride.screen.pinHint')}
        </T>
        <T variant="plate">{pinDigits(pin)}</T>
      </View>
    </View>
  );
}

/** Free waiting counts down; after it, the paid minutes and their price count up. */
function WaitingClock({ ride, rules }: { ride: Ride; rules: RideRules | null }) {
  const { t } = useT();
  const now = useNow(1000);
  if (!ride.arrivedAt) return null;
  if (!rules) {
    return (
      <T variant="body" color={colors.textMuted}>
        {t('ride.waiting.pleaseComeOut')}
      </T>
    );
  }
  const cargo = ride.service === 'cargo';
  const w = waitingState(ride.arrivedAt, rules.waiting, now);
  if (w.freeLeftS > 0) {
    const time = formatClock(w.freeLeftS);
    return (
      <View style={[styles.clock, { backgroundColor: colors.successSoft }]}>
        <Icon name="time-outline" size={20} color={colors.success} />
        <T variant="bodyStrong" style={styles.flex}>
          {cargo
            ? t('ride.waiting.freeLoading', { time })
            : t('ride.waiting.freeWaiting', { time })}
        </T>
      </View>
    );
  }
  const paid = { minutes: w.paidMinutes, fee: formatMoney(w.fee) };
  return (
    <View style={[styles.clock, { backgroundColor: colors.warningSoft }]}>
      <Icon name="hourglass-outline" size={20} color={colors.warning} />
      <T variant="bodyStrong" style={styles.flex}>
        {cargo ? t('ride.waiting.paidLoading', paid) : t('ride.waiting.paidWaiting', paid)}
      </T>
      <T variant="small" color={colors.textMuted}>
        {formatMoney(rules.waiting.per_minute)}
        {t('common.units.perMin')}
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
      {(ride.stops ?? []).map((stop, i) => (
        <View key={i} style={styles.routeBox}>
          <Icon name="arrow-down" size={14} color={colors.textMuted} />
          <T variant="small" color={colors.textMuted} numberOfLines={1}>
            {i + 1}. {placeLine(stop)} · {stopStateText(stop)}
          </T>
        </View>
      ))}
      <Icon name="arrow-down" size={14} color={colors.textMuted} />
      <T variant="small" color={colors.textMuted} numberOfLines={1}>
        {placeLine(ride.dropoff)}
      </T>
      {ride.passenger ? (
        <T variant="smallStrong" numberOfLines={1}>
          {passengerLine(ride.passenger)}
        </T>
      ) : null}
    </View>
  );
}

/**
 * The intermediate stops once a car is involved (the searching and scheduled panels list
 * the whole route instead): each with its state, and the way to change them while the
 * ride allows it (a cash taxi ride that is on; the price is confirmed first).
 */
function StopsBox({ ride }: { ride: Ride }) {
  const { t } = useT();
  const stops = ride.stops ?? [];
  if (!stops.length && !ride.canChangeStops) return null;
  return (
    <View style={styles.stopsBox}>
      {stops.length ? (
        <View accessible style={styles.routeBox}>
          {stops.map((stop, i) => (
            <View key={i} style={styles.stopRow}>
              <View style={styles.stopBadge}>
                <T variant="caption" color={colors.onInk}>
                  {i + 1}
                </T>
              </View>
              <T variant="small" style={styles.flex} numberOfLines={2}>
                {`${placeLine(stop)} · ${stopStateText(stop)}`}
              </T>
            </View>
          ))}
        </View>
      ) : null}
      {ride.canChangeStops ? (
        <Button
          title={stops.length ? t('ride.stops.edit') : t('ride.stops.add')}
          icon="git-branch-outline"
          variant="secondary"
          size="sm"
          onPress={() => router.push({ pathname: '/ride-stops', params: { id: ride.id } })}
          style={styles.stopsButton}
        />
      ) : null}
    </View>
  );
}

function SearchingInfo({ ride }: { ride: Ride }) {
  const { t } = useT();
  const now = useNow(1000);
  const elapsed = (now.getTime() - new Date(ride.requestedAt).getTime()) / 1000;
  return (
    <View style={styles.searchInfo}>
      <T variant="body" color={colors.textMuted}>
        {t('ride.searching.offering', { time: formatClock(elapsed) })}
      </T>
      <RouteBox ride={ride} />
      <FareLine ride={ride} />
      {elapsed > 180 ? <Banner tone="info" message={t('ride.searching.long')} /> : null}
    </View>
  );
}

/** A ride for later: when, where, the fixed price; the search starts 15 minutes before. */
function ScheduledInfo({ ride, rules }: { ride: Ride; rules: RideRules | null }) {
  const { t } = useT();
  return (
    <View style={styles.searchInfo}>
      <RouteBox ride={ride} />
      <FareLine ride={ride} />
      {ride.scheduledFor ? (
        <Banner
          tone="info"
          icon="notifications-outline"
          message={t('ride.scheduled.searchStarts', {
            time: formatTime(searchStartsAt(ride.scheduledFor)),
          })}
        />
      ) : null}
      {rules ? (
        <T variant="small" color={colors.textMuted}>
          {waitingRuleText(rules)}{' '}
          {(ride.fare.deposit ?? 0) > 0 && ride.scheduledFor
            ? t('ride.scheduled.depositRule', {
                amount: formatMoney(ride.fare.deposit!),
                time: formatTime(freeCancelUntil(ride.scheduledFor).toISOString()),
              })
            : t('ride.scheduled.cancelFree')}
        </T>
      ) : null}
    </View>
  );
}

/** A cargo ride's load or a delivery's parcel and its recipient (whom the driver calls). */
function LoadInfo({ ride }: { ride: Ride }) {
  const { t } = useT();
  const line = loadLine(ride);
  if (!line) return null;
  const phone = ride.service === 'delivery' ? ride.delivery?.recipientPhone : null;
  return (
    <View style={styles.load} accessible>
      <Icon
        name={ride.service === 'cargo' ? 'cube-outline' : 'mail-outline'}
        size={20}
        color={colors.ink}
      />
      <View style={styles.flex}>
        <T variant="smallStrong" numberOfLines={3}>
          {line}
        </T>
        {phone ? (
          <T variant="small" color={colors.textMuted}>
            {t('ride.screen.recipient', { phone: formatPhone(phone) })}
          </T>
        ) : null}
      </View>
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
  load: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(1.5) },
  struck: { textDecorationLine: 'line-through' },
  pin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(3.5),
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
    borderWidth: 2,
    borderColor: colors.brand,
  },
  occupancy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  routeBox: { gap: 2 },
  // the rows stretch (a shrink-wrapped parent would give the flexed text no width)
  stopsBox: { gap: space(2), alignSelf: 'stretch' },
  stopsButton: { alignSelf: 'flex-start' },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  stopBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.info,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
