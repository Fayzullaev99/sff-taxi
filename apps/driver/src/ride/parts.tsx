import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { driver } from '../api/driver';
import type { DriverRide } from '../api/types';
import { keys } from '../data/queries';
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
  const now = useTick(true);
  const waiting = waitingState(props.arrivedAt, now, rules);
  const tone = waiting.paid ? colors.warning : colors.success;
  return (
    <Card style={{ borderColor: tone, borderWidth: 2 }}>
      <Text style={styles.label}>{waiting.paid ? 'Pullik kutish' : 'Bepul kutish'}</Text>
      <Text style={[styles.clock, { color: tone }]} maxFontSizeMultiplier={1.2}>
        {waiting.paid ? clock(waiting.elapsedS - rules.freeMinutes * 60) : clock(waiting.freeLeftS)}
      </Text>
      <Muted>
        {waiting.paid
          ? `${waiting.paidMinutes} daqiqa × ${som(rules.perMinute)} = ${som(waiting.fee)} narxga qo‘shiladi`
          : `${rules.freeMinutes} daqiqa bepul, keyin har daqiqa ${som(rules.perMinute)}`}
      </Muted>
      {!waiting.canNoShow ? (
        <Muted>“Yo‘lovchi chiqmadi” {clock(waiting.noShowInS)} dan keyin mumkin</Muted>
      ) : (
        <Banner
          tone="info"
          icon="information-circle"
          text="Yo‘lovchi chiqmasa, bekor qilishda “Yo‘lovchi chiqmadi” ni tanlang — bekor qilish haqi sizga yoziladi (naqd safarda — yo‘lovchi keyingi safarida to‘laganda)."
        />
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
  // the fee changes once a minute: a slow tick is enough here
  const now = useTick(props.waitingNow, 5_000);
  const liveWaiting =
    props.waitingNow && props.arrivedAt
      ? waitingState(props.arrivedAt, now, props.rules).fee
      : undefined;
  const cash = cashBreakdown(ride, liveWaiting);
  const owedNote = owedFeeNote(cash.owedFee);
  const parts = cashPartsText(cash);
  return (
    <Card>
      <Text style={styles.label}>
        {ride.paymentMethod === 'cash'
          ? 'Yo‘lovchidan olinadi (naqd)'
          : cash.total > 0
            ? 'Kutish uchun naqd olinadi'
            : 'Naqd olmang — safar kartada to‘langan'}
      </Text>
      <Text
        style={styles.collect}
        adjustsFontSizeToFit
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
      >
        {digits(cash.total)} <Text style={styles.collectUnit}>so‘m</Text>
      </Text>
      {ride.paymentMethod === 'card' ? (
        <Muted>
          Safar narxi {som(ride.fare.quoted)} kartada oldindan to‘langan — balansingizga yoziladi
        </Muted>
      ) : parts ? (
        <Muted>{parts}</Muted>
      ) : (
        <Muted>Narx oldindan belgilangan va o‘zgarmaydi</Muted>
      )}
      {owedNote ? (
        <Banner
          tone="info"
          icon="information-circle"
          text={`${owedNote[0]!.toUpperCase()}${owedNote.slice(1)}. U balansingizdan o‘sha safar haydovchisiga o‘tkaziladi.`}
        />
      ) : null}
    </Card>
  );
});

const STOP_LABEL: Record<Stop['kind'], string> = { pickup: 'Qayerdan', dropoff: 'Qayerga' };

/** The route as an ordered list of stops; the current one is highlighted. */
export const StopList = memo(function StopList(props: {
  stops: readonly Stop[];
  ride: DriverRide;
}) {
  const { ride } = props;
  return (
    <Card>
      {props.stops.map((s) => (
        <View key={s.key} style={[styles.stop, s.done && { opacity: 0.55 }]}>
          <Ionicons
            name={s.kind === 'pickup' ? 'radio-button-on' : 'flag'}
            size={22}
            color={s.current ? colors.brand : s.kind === 'pickup' ? colors.brand : colors.text}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.stopLabel}>
              {STOP_LABEL[s.kind]}
              {s.kind === 'dropoff' ? ` · ${distance(ride.distanceM)}` : ''}
              {s.current ? ' · hozir' : s.done ? ' · o‘tildi' : ''}
            </Text>
            <Text style={styles.stopText}>{s.place.address ?? 'Xaritadagi nuqta'}</Text>
            {s.place.landmark ? (
              <Text style={styles.landmark}>Mo‘ljal: {s.place.landmark}</Text>
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

/** The rider: name, rating, a big call button, a no-show warning. */
export const RiderCard = memo(function RiderCard(props: {
  rider: NonNullable<DriverRide['rider']>;
  channel: string;
}) {
  const { rider } = props;
  return (
    <Card>
      <View style={styles.riderRow}>
        <View style={{ flex: 1 }}>
          <Title>{rider.name ?? 'Yo‘lovchi'}</Title>
          <Muted>
            {rider.rating.toFixed(1)} ★
            {props.channel === 'phone' ? ' · telefon orqali buyurtma' : ''}
          </Muted>
        </View>
        <Button
          title="Qo‘ng‘iroq"
          icon="call"
          variant="secondary"
          onPress={() => call(rider.phone)}
        />
      </View>
      {rider.noShows > 0 ? (
        <Banner
          tone="warning"
          icon="warning"
          text={`Bu yo‘lovchi ${rider.noShows} marta chiqmagan`}
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
      Alert.alert('Bekor qilinmadi', errorMessage(error));
      if (isApiError(error, 404)) void qc.invalidateQueries({ queryKey: keys.current });
    },
  });

  return (
    <Card style={{ borderColor: colors.danger, borderWidth: 2 }}>
      <Title>Bekor qilish sababi</Title>
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
        placeholder="Izoh (ixtiyoriy)"
        placeholderTextColor={colors.muted}
        maxLength={200}
        style={styles.note}
      />
      <Button
        title="Bekor qilish"
        variant="danger"
        icon="close-circle"
        disabled={!picked}
        loading={cancel.isPending}
        onPress={() => picked && !cancel.isPending && cancel.mutate(picked)}
      />
      <Button title="Safarni davom ettirish" variant="secondary" onPress={props.onClose} />
    </Card>
  );
}

const EMERGENCY: { label: string; number: string }[] = [
  { label: 'Yagona xizmat', number: '112' },
  { label: 'Militsiya', number: '102' },
  { label: 'Tez yordam', number: '103' },
];

/** SOS: operators are alerted with the position; emergency numbers one tap away. */
export const SosButton = memo(function SosButton(props: { rideId: string }) {
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
        'Operatorlar xabardor qilindi',
        'Xavf bo‘lsa, darhol qo‘ng‘iroq qiling:',
        EMERGENCY.map((e) => ({ text: `${e.label} ${e.number}`, onPress: () => call(e.number) })),
      );
    },
    onError: () =>
      Alert.alert('SOS yuborilmadi', 'Internet yo‘q bo‘lishi mumkin. 112 ga qo‘ng‘iroq qiling.', [
        { text: '112', onPress: () => call('112') },
        { text: 'Yopish', style: 'cancel' },
      ]),
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="SOS: favqulodda holat"
      onPress={() =>
        Alert.alert('SOS yuborilsinmi?', 'Operatorlarga joylashuvingiz bilan xabar boradi.', [
          { text: 'Yo‘q', style: 'cancel' },
          { text: 'SOS', style: 'destructive', onPress: () => send.mutate() },
        ])
      }
      style={({ pressed }) => [styles.sos, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.sosText} maxFontSizeMultiplier={1.2}>
        SOS
      </Text>
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
