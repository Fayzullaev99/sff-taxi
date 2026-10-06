import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { driver } from '../api/driver';
import type { DriverRide } from '../api/types';
import { keys, useCurrentRide, useWaitingRules } from '../data/queries';
import { errorMessage } from '../lib/api-client';
import { PAYMENT_METHODS, som } from '../lib/format';
import { headcountText, offerBadges, pinErrorText, poolRideIds, ridePool } from '../lib/pool';
import { optimisticStatus, runRideStep } from '../lib/ride-actions';
import { canCancel, cashBreakdown, owedFeeNote, type RideAction } from '../lib/ride-flow';
import { customerWord, depositLine, serviceOf, serviceStep } from '../lib/service';
import { nextStop, stopList, stopsFromPool } from '../lib/stops';
import type { WaitingRules } from '../lib/waiting';
import { scheduledLabel } from '../lib/when';
import { markRideEndedHere } from '../realtime/use-realtime';
import {
  arrivedAtOf,
  CancelPanel,
  CashCard,
  RiderCard,
  SosButton,
  StopList,
  WaitingCard,
} from '../ride/parts';
import { PinPad } from '../ride/pin-pad';
import { ServiceCard } from '../ride/service-card';
import { PoolRidersCard } from '../ride/pool-riders';
import { navigateTo } from '../ui/actions';
import { Banner, Button, Chip, EmptyState, ErrorState, Loading, Muted } from '../ui/components';
import { haptics } from '../ui/haptics';
import { Screen } from '../ui/screen';
import { colors, space } from '../ui/theme';

/** A step request gives up after this and is sent again (see lib/ride-actions). */
const STEP_TIMEOUT_MS = 12_000;

/**
 * The ride in progress, one big button per stop: go to the pickup → "Yetib keldim"
 * (free waiting, then paid) → "Yo‘lovchi chiqdi — Boshlash" (with the rider's 4-digit code
 * when the ride has one) → go to the destination → "Yakunlash". With several riders the
 * API's stop list decides the next stop and the button acts on that stop's ride.
 * Navigation opens the driver's navigator; each rider can be called; SOS is one tap away.
 */
export default function RideScreen() {
  const router = useRouter();
  const current = useCurrentRide();
  const ride = current.data ?? null;
  const rules = useWaitingRules(ride ? { lat: ride.pickup.lat, lng: ride.pickup.lng } : null);

  if (current.isPending) return <Loading />;
  // a failed fetch is not "no ride": the driver may have a rider waiting
  if (current.data === undefined && current.isError) {
    return (
      <Screen title="Safar" onBack={() => router.replace('/home')}>
        <ErrorState message={errorMessage(current.error)} onRetry={() => void current.refetch()} />
      </Screen>
    );
  }
  if (!ride) {
    return (
      <Screen title="Safar" onBack={() => router.replace('/home')}>
        <EmptyState
          icon="car-outline"
          title="Faol safar yo‘q"
          text="Yangi buyurtmalar liniyada keladi."
        />
        <Button title="Bosh sahifa" onPress={() => router.replace('/home')} />
      </Screen>
    );
  }
  return (
    <ActiveRide
      ride={ride}
      rules={rules}
      refreshing={current.isRefetching}
      onRefresh={() => void current.refetch()}
    />
  );
}

const STEP_ICON = { arrive: 'flag', start: 'play', complete: 'checkmark-done' } as const;

interface StepVars {
  rideId: string;
  action: RideAction;
  pin?: string;
}

function ActiveRide(props: {
  ride: DriverRide;
  rules: WaitingRules;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { rules } = props;
  const router = useRouter();
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [retries, setRetries] = useState(0);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<{ text: string; n: number } | null>(null);
  /** When "Yetib keldim" was tapped: the waiting timer starts at once. */
  const tappedAt = useRef<number | null>(null);

  // several riders: every ride's own view (cash to take, phone), refreshed with the current one
  const pool = ridePool(props.ride);
  const ids = pool ? poolRideIds(pool, props.ride.id) : [];
  const views = useQueries({
    queries: ids.map((id) => ({
      queryKey: keys.ride(id),
      queryFn: () => driver.ride(id),
      staleTime: 5_000,
      refetchInterval: 30_000,
    })),
  });
  const poolRides = views.map((v) => v.data).filter((r): r is DriverRide => !!r);

  // the stop to act on: the API's first stop (its ride is the current one), else this ride
  const baseStops = useMemo(() => (pool ? stopsFromPool(pool.stops) : null), [pool]);
  const firstStop = baseStops ? nextStop(baseStops) : null;
  const focus: DriverRide =
    (firstStop &&
      (firstStop.rideId.toLowerCase() === props.ride.id.toLowerCase()
        ? props.ride
        : poolRides.find((r) => r.id.toLowerCase() === firstStop.rideId.toLowerCase()))) ||
    props.ride;
  // the next stop belongs to another rider whose ride has not loaded (or failed): the big
  // button must not act on this ride meanwhile ("Yakunlash" at someone else's pickup)
  const focusMissing =
    !!firstStop &&
    firstStop.rideId.toLowerCase() !== props.ride.id.toLowerCase() &&
    focus === props.ride;
  const missingView = focusMissing
    ? views.find((_, i) => ids[i]?.toLowerCase() === firstStop!.rideId.toLowerCase())
    : undefined;

  const act = useMutation({
    mutationFn: (v: StepVars) => {
      if (v.action === 'complete') markRideEndedHere(v.rideId);
      return runRideStep({
        send: () => driver.step(v.rideId, v.action, { timeoutMs: STEP_TIMEOUT_MS, pin: v.pin }),
        fetchRide: () => driver.ride(v.rideId),
        action: v.action,
        retry: { onRetry: (n) => setRetries(n) },
      });
    },
    onMutate: (v) => {
      setRetries(0);
      if (v.action === 'arrive') tappedAt.current = Date.now();
    },
    onSuccess: (next, v) => {
      haptics.success();
      setPinOpen(false);
      setPinError(null);
      qc.setQueryData(keys.ride(next.id), next);
      if (v.action === 'complete') {
        qc.setQueryData(keys.current, null);
        void qc.invalidateQueries({ queryKey: keys.current });
        void qc.invalidateQueries({ queryKey: keys.balance });
        void qc.invalidateQueries({ queryKey: keys.me });
        void qc.invalidateQueries({ queryKey: ['driver', 'earnings'] });
        router.replace(`/ride-done/${next.id}`);
        return;
      }
      if (!pool) qc.setQueryData(keys.current, next);
      // with several riders the next stop may belong to another ride now
      void qc.invalidateQueries({ queryKey: keys.current });
    },
    onError: (error, v) => {
      tappedAt.current = null;
      haptics.error();
      const pinText = v.action === 'start' ? pinErrorText(error) : null;
      if (pinText) {
        setPinError({ text: pinText, n: Date.now() });
        return;
      }
      setPinOpen(false);
      Alert.alert('Amal bajarilmadi', errorMessage(error));
      void qc.invalidateQueries({ queryKey: keys.current });
    },
    onSettled: () => setRetries(0),
  });

  // arrive and start show their result at once (optimistic); completing waits for the
  // server's final fare
  const pending = act.isPending ? act.variables : null;
  const optimistic =
    pending && pending.action !== 'complete' && pending.rideId === focus.id ? pending.action : null;
  const status = optimisticStatus(focus.status, optimistic);
  const service = serviceOf(focus);
  const step = serviceStep(status, service);
  const shown = useMemo(() => ({ ...focus, status }) as DriverRide, [focus, status]);
  const stops = useMemo(() => {
    if (!baseStops) return stopList([shown]);
    // an optimistic "Boshlash" passes the pickup already
    return optimistic === 'start' ? stopsFromPool(pool!.stops.slice(1)) : baseStops;
  }, [baseStops, shown, optimistic, pool]);
  const target = nextStop(stops);
  const arrivedAt = arrivedAtOf(focus, optimistic === 'arrive' ? tappedAt.current : null);
  const waitingNow = status === 'driver_arrived' && arrivedAt !== null;

  const run = (action: RideAction, pin?: string) =>
    act.mutate({ rideId: focus.id, action, ...(pin ? { pin } : {}) });

  const onStep = () => {
    if (!step || act.isPending || focusMissing) return;
    if (step.action === 'start' && focus.hasStartPin) {
      setPinError(null);
      setPinOpen(true);
      return;
    }
    if (step.action === 'complete') {
      const cash = cashBreakdown(focus);
      const owedNote = owedFeeNote(cash.owedFee);
      const deposit = depositLine(focus.fare.deposit, cash.total);
      Alert.alert(
        service === 'delivery'
          ? 'Posilkani topshirdingizmi?'
          : service === 'cargo'
            ? 'Yukni topshirdingizmi?'
            : 'Safarni yakunlaysizmi?',
        focus.paymentMethod === 'card'
          ? cash.total > 0
            ? `Kartada oldindan to‘langan. Kutish uchun ${som(cash.total)} naqd oling.`
            : 'Kartada oldindan to‘langan: naqd pul olmang.'
          : `${focus.rider?.name ?? customerWord(service)}dan ${som(cash.total)} oling.${deposit ? ` ${deposit}.` : ''}${owedNote ? ` (${owedNote}.)` : ''}`,
        [
          { text: 'Yo‘q', style: 'cancel' },
          {
            text: service === 'delivery' ? 'Topshirdim' : 'Yakunlash',
            onPress: () => run('complete'),
          },
        ],
      );
      return;
    }
    run(step.action);
  };

  const scheduled = scheduledLabel(focus.scheduledFor, Date.now());
  const navTitle =
    target?.kind === 'dropoff'
      ? service === 'delivery'
        ? 'Qabul qiluvchiga yo‘l'
        : 'Manzilga yo‘l'
      : service === 'taxi'
        ? 'Yo‘lovchiga yo‘l'
        : 'Olish joyiga yo‘l';
  const badges = offerBadges(focus);

  return (
    <Screen
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
      footer={
        cancelling || !step ? null : (
          <>
            {pending ? (
              <Text style={styles.pending} accessibilityLiveRegion="polite">
                {retries > 0
                  ? `Aloqa sust — qayta yuborilmoqda (${retries})…`
                  : pending.action === 'complete'
                    ? 'Yakunlanmoqda…'
                    : 'Yuborilmoqda…'}
              </Text>
            ) : null}
            <Button
              title={
                pool && step.action !== 'arrive' && focus.rider?.name
                  ? `${step.button} · ${focus.rider.name}`
                  : step.button
              }
              big
              variant={step.action === 'complete' ? 'success' : 'primary'}
              icon={STEP_ICON[step.action]}
              // an optimistic step shows the next button, which waits for the first to land
              loading={pending?.action === 'complete' || (focusMissing && !missingView?.isError)}
              disabled={act.isPending || focusMissing}
              onPress={onStep}
              style={{ minHeight: 76 }}
            />
            {focusMissing && missingView?.isError ? (
              <Button
                title="Keyingi yo‘lovchi ma’lumotini qayta yuklash"
                icon="refresh"
                variant="secondary"
                onPress={() => void missingView.refetch()}
              />
            ) : null}
          </>
        )
      }
    >
      <View style={styles.head}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text style={styles.status} maxFontSizeMultiplier={1.3}>
            {step?.title ?? 'Safar'}
          </Text>
          <Muted>
            #{focus.number} · {PAYMENT_METHODS[focus.paymentMethod] ?? focus.paymentMethod}
          </Muted>
          {pool ? <Muted>{headcountText(focus.passengers, pool)}</Muted> : null}
          {scheduled ? <Chip label={scheduled} tone="info" icon="calendar" /> : null}
          {badges.length ? (
            <View style={styles.badges}>
              {badges.map((b) => (
                <Chip key={b.label} label={b.label} tone={b.tone} />
              ))}
            </View>
          ) : null}
        </View>
        <SosButton rideId={focus.id} />
      </View>

      {retries > 1 ? (
        <Banner
          tone="warning"
          icon="cloud-offline"
          text="Internet sust. Amal saqlandi va aloqa tiklanishi bilan yuboriladi — ilovani yopmang."
        />
      ) : null}

      {target && step?.navigateTo ? (
        <Button
          title={navTitle}
          icon="navigate"
          big
          variant="secondary"
          onPress={() => void navigateTo(target.place, navTitle)}
        />
      ) : null}

      {waitingNow && arrivedAt ? <WaitingCard arrivedAt={arrivedAt} rules={rules} /> : null}

      {status === 'in_progress' || status === 'driver_arrived' ? (
        <CashCard ride={focus} arrivedAt={arrivedAt} waitingNow={waitingNow} rules={rules} />
      ) : null}

      <ServiceCard ride={shown} />

      <StopList stops={stops} ride={focus} />

      {pool && poolRides.length ? (
        <PoolRidersCard rides={poolRides} focusId={focus.id} seats={pool.occupancy ?? null} />
      ) : focus.rider ? (
        <RiderCard rider={focus.rider} channel={focus.channel} />
      ) : null}

      {canCancel(status) ? (
        cancelling ? (
          <CancelPanel
            ride={shown}
            arrivedAt={arrivedAt}
            rules={rules}
            onClose={() => setCancelling(false)}
          />
        ) : (
          <Button
            title={pool ? `#${focus.number} buyurtmani bekor qilish` : 'Buyurtmani bekor qilish'}
            icon="close-circle"
            variant="danger"
            disabled={act.isPending}
            onPress={() => setCancelling(true)}
          />
        )
      ) : (
        <Muted center>Safar boshlangan: muammo bo‘lsa operatorga qo‘ng‘iroq qiling.</Muted>
      )}

      <PinPad
        visible={pinOpen}
        riderName={focus.rider?.name ?? null}
        busy={act.isPending}
        error={pinError}
        onSubmit={(pin) => run('start', pin)}
        onClose={() => setPinOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  status: { fontSize: 28, fontWeight: '900', color: colors.text },
  pending: { color: colors.warning, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
