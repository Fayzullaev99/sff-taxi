import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { driver } from '../api/driver';
import type { DriverRide } from '../api/types';
import { keys, useCurrentRide, useWaitingRules } from '../data/queries';
import { errorMessage } from '../lib/api-client';
import { PAYMENT_METHODS, som } from '../lib/format';
import { optimisticStatus, runRideStep } from '../lib/ride-actions';
import { canCancel, cashBreakdown, owedFeeNote, type RideAction, stepOf } from '../lib/ride-flow';
import { nextStop, stopList } from '../lib/stops';
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
import { navigateTo } from '../ui/actions';
import { Banner, Button, Chip, EmptyState, Loading, Muted } from '../ui/components';
import { haptics } from '../ui/haptics';
import { Screen } from '../ui/screen';
import { colors, space } from '../ui/theme';

/** A step request gives up after this and is sent again (see lib/ride-actions). */
const STEP_TIMEOUT_MS = 12_000;

/**
 * The ride in progress, one big button per step: go to the pickup → "Yetib keldim"
 * (free waiting, then paid) → "Yo‘lovchi chiqdi — Boshlash" → go to the destination →
 * "Yakunlash". Navigation opens the driver's navigator; the rider can be called; SOS is
 * always one tap away.
 */
export default function RideScreen() {
  const router = useRouter();
  const current = useCurrentRide();
  const ride = current.data ?? null;
  const rules = useWaitingRules(ride ? { lat: ride.pickup.lat, lng: ride.pickup.lng } : null);

  if (current.isPending) return <Loading />;
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

function ActiveRide(props: {
  ride: DriverRide;
  rules: WaitingRules;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { ride, rules } = props;
  const router = useRouter();
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [retries, setRetries] = useState(0);
  /** When "Yetib keldim" was tapped: the waiting timer starts at once. */
  const tappedAt = useRef<number | null>(null);

  const act = useMutation({
    mutationFn: (action: RideAction) => {
      if (action === 'complete') markRideEndedHere(ride.id);
      return runRideStep({
        send: () => driver.step(ride.id, action, STEP_TIMEOUT_MS),
        fetchRide: () => driver.ride(ride.id),
        action,
        retry: { onRetry: (n) => setRetries(n) },
      });
    },
    onMutate: (action) => {
      setRetries(0);
      if (action === 'arrive') tappedAt.current = Date.now();
    },
    onSuccess: (next, action) => {
      haptics.success();
      if (action === 'complete') {
        qc.setQueryData(keys.current, null);
        qc.setQueryData(keys.ride(next.id), next);
        void qc.invalidateQueries({ queryKey: keys.balance });
        void qc.invalidateQueries({ queryKey: keys.me });
        void qc.invalidateQueries({ queryKey: ['driver', 'earnings'] });
        router.replace(`/ride-done/${next.id}`);
        return;
      }
      qc.setQueryData(keys.current, next);
    },
    onError: (error) => {
      // the optimistic step is undone by itself: the screen shows the ride as it is
      tappedAt.current = null;
      haptics.error();
      Alert.alert('Amal bajarilmadi', errorMessage(error));
      void qc.invalidateQueries({ queryKey: keys.current });
    },
    onSettled: () => setRetries(0),
  });

  // arrive and start show their result at once (optimistic); completing waits for the
  // server's final fare
  const pendingAction = act.isPending ? act.variables : null;
  const optimistic = pendingAction && pendingAction !== 'complete' ? pendingAction : null;
  const status = optimisticStatus(ride.status, optimistic);
  const step = stepOf(status);
  const shown = useMemo(() => ({ ...ride, status }) as DriverRide, [ride, status]);
  const stops = useMemo(() => stopList([shown]), [shown]);
  const target = nextStop(stops);
  const arrivedAt = arrivedAtOf(ride, optimistic === 'arrive' ? tappedAt.current : null);
  const waitingNow = status === 'driver_arrived' && arrivedAt !== null;

  const onStep = () => {
    if (!step || act.isPending) return;
    if (step.action === 'complete') {
      const cash = cashBreakdown(ride);
      const owedNote = owedFeeNote(cash.owedFee);
      Alert.alert(
        'Safarni yakunlaysizmi?',
        ride.paymentMethod === 'card'
          ? cash.total > 0
            ? `Safar kartada oldindan to‘langan. Kutish uchun ${som(cash.total)} naqd oling.`
            : 'Safar kartada oldindan to‘langan: naqd pul olmang.'
          : `Yo‘lovchidan ${som(cash.total)} oling.${owedNote ? ` (${owedNote}.)` : ''}`,
        [
          { text: 'Yo‘q', style: 'cancel' },
          { text: 'Yakunlash', onPress: () => act.mutate('complete') },
        ],
      );
      return;
    }
    act.mutate(step.action);
  };

  const scheduled = scheduledLabel(ride.scheduledFor, Date.now());
  const navTitle = target?.kind === 'dropoff' ? 'Manzilga yo‘l' : 'Yo‘lovchiga yo‘l';

  return (
    <Screen
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
      footer={
        cancelling || !step ? null : (
          <>
            {pendingAction ? (
              <Text style={styles.pending} accessibilityLiveRegion="polite">
                {retries > 0
                  ? `Aloqa sust — qayta yuborilmoqda (${retries})…`
                  : pendingAction === 'complete'
                    ? 'Yakunlanmoqda…'
                    : 'Yuborilmoqda…'}
              </Text>
            ) : null}
            <Button
              title={step.button}
              big
              variant={step.action === 'complete' ? 'success' : 'primary'}
              icon={STEP_ICON[step.action]}
              // an optimistic step shows the next button, which waits for the first to land
              loading={pendingAction === 'complete'}
              disabled={act.isPending}
              onPress={onStep}
              style={{ minHeight: 76 }}
            />
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
            #{ride.number} · {PAYMENT_METHODS[ride.paymentMethod] ?? ride.paymentMethod}
          </Muted>
          {scheduled ? <Chip label={scheduled} tone="info" icon="calendar" /> : null}
        </View>
        <SosButton rideId={ride.id} />
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
        <CashCard ride={ride} arrivedAt={arrivedAt} waitingNow={waitingNow} rules={rules} />
      ) : null}

      <StopList stops={stops} ride={ride} />

      {ride.rider ? <RiderCard rider={ride.rider} channel={ride.channel} /> : null}

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
            title="Buyurtmani bekor qilish"
            icon="close-circle"
            variant="danger"
            disabled={act.isPending}
            onPress={() => setCancelling(true)}
          />
        )
      ) : (
        <Muted center>Safar boshlangan: muammo bo‘lsa operatorga qo‘ng‘iroq qiling.</Muted>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  status: { fontSize: 28, fontWeight: '900', color: colors.text },
  pending: { color: colors.warning, fontSize: 15, fontWeight: '800', textAlign: 'center' },
});
