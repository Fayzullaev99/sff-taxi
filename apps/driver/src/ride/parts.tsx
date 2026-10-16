import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { driver } from '../api/driver';
import type { DriverRide } from '../api/types';
import { keys } from '../data/queries';
import { useT } from '../i18n';
import { errorMessage, isApiError } from '../lib/api-client';
import { clock, digits, distance, RIDE_OPTIONS, som } from '../lib/format';
import { withRetry } from '../lib/ride-actions';
import {
  cancelChoices,
  type CancelReason,
  cashBreakdown,
  cashPartsText,
  owedFeeNote,
} from '../lib/ride-flow';
import { depositLine, serviceOf } from '../lib/service';
import type { Stop } from '../lib/stops';
import { waitingState, type WaitingRules } from '../lib/waiting';
import { markRideEndedHere } from '../realtime/use-realtime';
import { call } from '../ui/actions';
import { Banner, Button, Card, Chip, Muted, Title } from '../ui/components';
import { haptics } from '../ui/haptics';
import { colors, radius, space } from '../ui/theme';

/**
 * The pieces of the ride screen. Each keeps its own clock (the waiting timer ticks every
 * second) so the rest of the screen is not redrawn with it. Stops are rendered as a list,
 * so several riders at once (shared rides) only add entries.
 */

/** The current time, re-read every `everyMs` while `on`. */
export function useTick(on: boolean, everyMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [on, everyMs]);
  return now;
}

/** When the waiting started: the server's time, or the tap while "Yetib keldim" is on its way. */
export function arrivedAtOf(ride: DriverRide, optimisticAt: number | null): string | null {
  if (ride.arrivedAt) return ride.arrivedAt;
  return optimisticAt === null ? null : new Date(optimisticAt).toISOString();
}

/** Free, then paid waiting at the pickup, with the no-show countdown. */
export const WaitingCard = memo(function WaitingCard(props: {
  arrivedAt: string;
  rules: WaitingRules;
}) {
  const { rules } = props;
  const { t } = useT();
  const now = useTick(true);
  const waiting = waitingState(props.arrivedAt, now, rules);
  const tone = waiting.paid ? colors.warning : colors.success;
  return (
    <Card style={{ borderColor: tone, borderWidth: 2 }}>
      <Text style={styles.label}>
        {t(waiting.paid ? 'ride.waiting.paid' : 'ride.waiting.free')}
      </Text>
      <Text style={[styles.clock, { color: tone }]} maxFontSizeMultiplier={1.2}>
        {waiting.paid ? clock(waiting.elapsedS - rules.freeMinutes * 60) : clock(waiting.freeLeftS)}
      </Text>
      <Muted>
        {waiting.paid
          ? t('ride.waiting.paidLine', {
              minutes: waiting.paidMinutes,
              perMinute: som(rules.perMinute),
              fee: som(waiting.fee),
            })
          : t('ride.waiting.freeLine', {
              minutes: rules.freeMinutes,
              perMinute: som(rules.perMinute),
            })}
      </Muted>
      {!waiting.canNoShow ? (
        <Muted>{t('ride.waiting.noShowIn', { time: clock(waiting.noShowInS) })}</Muted>
      ) : (
        <Banner tone="info" icon="information-circle" text={t('ride.waiting.noShowHint')} />
      )}
    </Card>
  );
});

/** The cash to take, huge; while waiting it grows with the paid minutes. */
export const CashCard = memo(function CashCard(props: {
  ride: DriverRide;
  arrivedAt: string | null;
  waitingNow: boolean;
  rules: WaitingRules;
}) {
  const { ride } = props;
  const { t } = useT();
  // the fee changes once a minute: a slow tick is enough here
  const now = useTick(props.waitingNow, 5_000);
  const liveWaiting =
    props.waitingNow && props.arrivedAt
      ? waitingState(props.arrivedAt, now, props.rules).fee
      : undefined;
  const cash = cashBreakdown(ride, liveWaiting);
  const owedNote = owedFeeNote(cash.owedFee);
  const parts = cashPartsText(cash);
  // part paid by card in advance (a ride booked for later): the rest is cash
  const deposit = depositLine(ride.fare.deposit, cash.total);
  return (
    <Card>
      <Text style={styles.label}>
        {ride.paymentMethod === 'cash'
          ? serviceOf(ride) === 'taxi'
            ? t('ride.flow.cashFromRider')
            : t('ride.flow.cashFromCustomer')
          : cash.total > 0
            ? t('ride.flow.cashForWaiting')
            : t('ride.flow.cashNoneCard')}
      </Text>
      <Text
        style={styles.collect}
        adjustsFontSizeToFit
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
      >
        {digits(cash.total)} <Text style={styles.collectUnit}>{t('common.units.som')}</Text>
      </Text>
      {ride.paymentMethod === 'card' ? (
        <Muted>{t('ride.flow.cashPrepaid', { amount: som(ride.fare.quoted) })}</Muted>
      ) : deposit ? (
        <Banner tone="info" icon="card" text={deposit} />
      ) : parts ? (
        <Muted>{parts}</Muted>
      ) : (
        <Muted>{t('ride.flow.cashFixed')}</Muted>
      )}
      {owedNote ? (
        <Banner
          tone="info"
          icon="information-circle"
          text={t('ride.flow.owedTransfer', {
            note: `${owedNote[0]!.toUpperCase()}${owedNote.slice(1)}`,
          })}
        />
      ) : null}
    </Card>
  );
});

/** The route as an ordered list of stops; the current one is highlighted. */
export const StopList = memo(function StopList(props: {
  stops: readonly Stop[];
  ride: DriverRide;
}) {
  const { ride } = props;
  const { t } = useT();
  /** The first line of a stop: whose it is and what happens there. */
  const stopLabel = (s: Stop): string => {
    if (s.riderName !== undefined) {
      // several riders: whose stop, how many get in or out
      const what = t(s.kind === 'pickup' ? 'ride.stops.pickupWord' : 'ride.stops.dropoffWord');
      const who = s.riderName ?? t('ride.flow.rider');
      const people =
        (s.passengers ?? 1) > 1 ? ` · ${t('ride.flow.people', { count: s.passengers! })}` : '';
      return `${what} · ${who}${people}${s.rideNumber ? ` · #${s.rideNumber}` : ''}`;
    }
    if (s.kind === 'via') return t('ride.stops.viaN', { n: (s.index ?? 0) + 1 });
    if (s.kind === 'dropoff') return `${t('ride.stops.dropoff')} · ${distance(ride.distanceM)}`;
    return t('ride.stops.pickup');
  };
  return (
    <Card>
      {props.stops.map((s) => (
        <View key={s.key} style={[styles.stop, s.done && { opacity: 0.55 }]}>
          <Ionicons
            name={s.kind === 'pickup' ? 'radio-button-on' : s.kind === 'via' ? 'ellipse' : 'flag'}
            size={22}
            color={s.current ? colors.brand : s.kind === 'pickup' ? colors.brand : colors.text}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.stopLabel}>
              {stopLabel(s)}
              {s.arrived
                ? ` · ${t('ride.stops.here')}`
                : s.current
                  ? ` · ${t('ride.stops.now')}`
                  : s.done
                    ? ` · ${t('ride.stops.passed')}`
                    : ''}
            </Text>
            <Text style={styles.stopText}>{s.place.address ?? t('ride.stops.mapPoint')}</Text>
            {s.place.landmark ? (
              <Text style={styles.landmark}>
                {t('ride.stops.landmark', { landmark: s.place.landmark })}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      {ride.options.length ? (
        <View style={styles.chips}>
          {ride.options.map((o) => (
            <Chip key={o} label={RIDE_OPTIONS[o] ?? o} tone="brand" />
          ))}
        </View>
      ) : null}
      {ride.comment ? <Text style={styles.comment}>“{ride.comment}”</Text> : null}
    </Card>
  );
});

/**
 * A ride ordered for someone else: the passenger is who gets in — the driver calls them
 * (the person who ordered tracks and pays; their card is below).
 */
export const PassengerCard = memo(function PassengerCard(props: {
  passenger: NonNullable<DriverRide['passenger']>;
  ordererName: string | null;
}) {
  const { passenger } = props;
  const { t } = useT();
  return (
    <Card>
      <View style={styles.riderRow}>
        <View style={{ flex: 1 }}>
          <Muted>{t('ride.flow.passengerTitle')}</Muted>
          <Title>{passenger.name ?? t('ride.flow.rider')}</Title>
          <Muted>
            {t('ride.flow.orderer', { name: props.ordererName ?? t('ride.flow.customer') })}
          </Muted>
        </View>
        {passenger.phone ? (
          <Button
            title={t('ride.flow.call')}
            icon="call"
            variant="secondary"
            onPress={() => call(passenger.phone!)}
          />
        ) : null}
      </View>
    </Card>
  );
});

/** The rider: name, rating, a big call button, a no-show warning. */
export const RiderCard = memo(function RiderCard(props: {
  rider: NonNullable<DriverRide['rider']>;
  channel: string;
}) {
  const { rider } = props;
  const { t } = useT();
  return (
    <Card>
      <View style={styles.riderRow}>
        <View style={{ flex: 1 }}>
          <Title>{rider.name ?? t('ride.flow.rider')}</Title>
          <Muted>
            {rider.rating.toFixed(1)} ★
            {props.channel === 'phone' ? ` · ${t('ride.flow.byPhone')}` : ''}
          </Muted>
        </View>
        {rider.phone ? (
          <Button
            title={t('ride.flow.call')}
            icon="call"
            variant="secondary"
            onPress={() => call(rider.phone)}
          />
        ) : null}
      </View>
      {rider.noShows > 0 ? (
        <Banner
          tone="warning"
          icon="warning"
          text={t('ride.flow.noShows', { count: rider.noShows })}
        />
      ) : null}
    </Card>
  );
});

/** Why the driver gives the ride up; the no-show reason unlocks after the wait. */
export function CancelPanel(props: {
  ride: DriverRide;
  arrivedAt: string | null;
  rules: WaitingRules;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { t } = useT();
  const [note, setNote] = useState('');
  const waitingNow = props.ride.status === 'driver_arrived' && props.arrivedAt !== null;
  const now = useTick(waitingNow);
  const noShowInS =
    waitingNow && props.arrivedAt
      ? waitingState(props.arrivedAt, now, props.rules).noShowInS
      : null;
  const choices = cancelChoices(props.ride.status, noShowInS);
  const [picked, setPicked] = useState<CancelReason | null>(null);
  const choice = choices.find((c) => c.code === picked) ?? null;

  const done = () => {
    haptics.success();
    qc.setQueryData(keys.current, null);
    void qc.invalidateQueries({ queryKey: keys.me });
    void qc.invalidateQueries({ queryKey: keys.balance });
    router.replace('/home');
  };

  const cancel = useMutation({
    mutationFn: (code: CancelReason) => {
      markRideEndedHere(props.ride.id);
      let retried = false;
      return withRetry(() => driver.cancel(props.ride.id, code, note.trim() || null), {
        attempts: 4,
        baseMs: 1_000,
        maxMs: 5_000,
        onRetry: () => {
          retried = true;
        },
      }).catch((error: unknown) => {
        // the first request went through and only its answer was lost
        if (retried && isApiError(error, 404)) return undefined;
        throw error;
      });
    },
    onSuccess: done,
    onError: (error) => {
      haptics.error();
      Alert.alert(t('ride.cancel.failed'), errorMessage(error));
      if (isApiError(error, 404)) void qc.invalidateQueries({ queryKey: keys.current });
    },
  });

  return (
    <Card style={{ borderColor: colors.danger, borderWidth: 2 }}>
      <Title>{t('ride.cancel.title')}</Title>
      {choices.map((c) => (
        <Pressable
          key={c.code}
          disabled={c.disabledBecause !== null}
          onPress={() => {
            haptics.select();
            setPicked(c.code);
          }}
          accessibilityRole="radio"
          accessibilityState={{ checked: picked === c.code, disabled: c.disabledBecause !== null }}
          style={[
            styles.reason,
            picked === c.code && styles.reasonOn,
            c.disabledBecause !== null && { opacity: 0.5 },
          ]}
        >
          <Text style={[styles.reasonText, picked === c.code && { color: colors.onBrand }]}>
            {c.label}
          </Text>
          {c.disabledBecause ? <Text style={styles.reasonWhy}>{c.disabledBecause}</Text> : null}
        </Pressable>
      ))}
      {choice ? (
        <Banner tone={choice.code === 'rider_no_show' ? 'info' : 'warning'} text={choice.effect} />
      ) : null}
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t('ride.cancel.notePlaceholder')}
        placeholderTextColor={colors.muted}
        maxLength={200}
        style={styles.note}
      />
      <Button
        title={t('ride.cancel.confirm')}
        variant="danger"
        icon="close-circle"
        disabled={!picked}
        loading={cancel.isPending}
        onPress={() => picked && !cancel.isPending && cancel.mutate(picked)}
      />
      <Button title={t('ride.cancel.keepRiding')} variant="secondary" onPress={props.onClose} />
    </Card>
  );
}

/** The emergency numbers, labelled in the app's language. */
const EMERGENCY = [
  { label: 'ride.flow.emergency', number: '112' },
  { label: 'ride.flow.police', number: '102' },
  { label: 'ride.flow.ambulance', number: '103' },
] as const;

/** SOS: operators are alerted with the position; emergency numbers one tap away. */
export const SosButton = memo(function SosButton(props: { rideId: string }) {
  const { t } = useT();
  const send = useMutation({
    mutationFn: async () => {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 }).catch(() => null);
      return withRetry(
        () =>
          driver.sos(props.rideId, last?.coords.latitude ?? null, last?.coords.longitude ?? null),
        { attempts: 3, baseMs: 1_000, maxMs: 3_000 },
      );
    },
    onSuccess: () => {
      haptics.warning();
      Alert.alert(
        t('ride.flow.sosSentTitle'),
        t('ride.flow.sosSentText'),
        EMERGENCY.map((e) => ({
          text: `${t(e.label)} ${e.number}`,
          onPress: () => call(e.number),
        })),
      );
    },
    onError: () =>
      Alert.alert(t('ride.flow.sosFailedTitle'), t('ride.flow.sosFailedText'), [
        { text: '112', onPress: () => call('112') },
        { text: t('common.actions.close'), style: 'cancel' },
      ]),
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={send.isPending ? t('ride.flow.sosSendingA11y') : t('ride.flow.sosA11y')}
      accessibilityState={{ busy: send.isPending, disabled: send.isPending }}
      // while it is being sent (up to 3 tries) a second tap would raise a second alarm
      disabled={send.isPending}
      onPress={() =>
        Alert.alert(t('ride.flow.sosConfirmTitle'), t('ride.flow.sosConfirmText'), [
          { text: t('common.actions.no'), style: 'cancel' },
          { text: 'SOS', style: 'destructive', onPress: () => send.mutate() },
        ])
      }
      style={({ pressed }) => [styles.sos, (pressed || send.isPending) && { opacity: 0.7 }]}
    >
      {send.isPending ? (
        <ActivityIndicator color={colors.onDanger} />
      ) : (
        <Text style={styles.sosText} maxFontSizeMultiplier={1.2}>
          SOS
        </Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '800', color: colors.muted, textTransform: 'uppercase' },
  clock: { fontSize: 64, fontWeight: '900', fontVariant: ['tabular-nums'] },
  collect: { fontSize: 64, fontWeight: '900', color: colors.brand, fontVariant: ['tabular-nums'] },
  collectUnit: { fontSize: 28, fontWeight: '800' },
  stop: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  stopLabel: { fontSize: 14, color: colors.muted, fontWeight: '700' },
  stopText: { fontSize: 19, color: colors.text, fontWeight: '800' },
  landmark: { fontSize: 15, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  comment: { fontSize: 16, color: colors.text, fontStyle: 'italic' },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  reason: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  reasonOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  reasonText: { fontSize: 17, fontWeight: '700', color: colors.text },
  reasonWhy: { fontSize: 14, color: colors.muted, marginTop: 2 },
  note: {
    minHeight: 52,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: 16,
  },
  sos: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosText: { color: colors.onDanger, fontWeight: '900', fontSize: 18 },
});
