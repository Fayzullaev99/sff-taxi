import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { driver } from '../api/driver';
import type { DriverRide } from '../api/types';
import { keys, useCurrentRide, useWaitingRules } from '../data/queries';
import { errorMessage, isApiError } from '../lib/api-client';
import { clock, digits, distance, PAYMENT_METHODS, RIDE_OPTIONS, som } from '../lib/format';
import {
  amountToCollect,
  cancelChoices,
  cashToCollect,
  canCancel,
  type CancelReason,
  stepOf,
} from '../lib/ride-flow';
import { waitingState, type WaitingRules } from '../lib/waiting';
import { scheduledLabel } from '../lib/when';
import { markRideEndedHere } from '../realtime/use-realtime';
import { call, navigateTo } from '../ui/actions';
import { Banner, Button, Card, Chip, EmptyState, Loading, Muted, Title } from '../ui/components';
import { haptics } from '../ui/haptics';
import { Screen } from '../ui/screen';
import { colors, radius, space } from '../ui/theme';

/** Re-renders every second while `on` (the waiting timer). */
function useSecondTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

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

function ActiveRide(props: {
  ride: DriverRide;
  rules: WaitingRules;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { ride, rules } = props;
  const router = useRouter();
  const qc = useQueryClient();
  const step = stepOf(ride.status);
  const [cancelling, setCancelling] = useState(false);
  const now = useSecondTick(ride.status === 'driver_arrived');
  const waiting =
    ride.status === 'driver_arrived' && ride.arrivedAt
      ? waitingState(ride.arrivedAt, now, rules)
      : null;

  const act = useMutation({
    mutationFn: (action: 'arrive' | 'start' | 'complete') => {
      if (action === 'complete') markRideEndedHere(ride.id);
      return driver.step(ride.id, action);
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
      haptics.error();
      Alert.alert('Amal bajarilmadi', errorMessage(error));
      void qc.invalidateQueries({ queryKey: keys.current });
    },
  });

  const onStep = () => {
    if (!step) return;
    if (step.action === 'complete') {
      const cashNow = cashToCollect(ride.paymentMethod, ride.fare);
      Alert.alert(
        'Safarni yakunlaysizmi?',
        ride.paymentMethod === 'card'
          ? cashNow > 0
            ? `Safar kartada oldindan to‘langan. Kutish uchun ${som(cashNow)} naqd oling.`
            : 'Safar kartada oldindan to‘langan: naqd pul olmang.'
          : `Yo‘lovchidan ${som(cashNow)} oling.`,
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
  const target = step?.navigateTo === 'dropoff' ? ride.dropoff : ride.pickup;
  const collect = amountToCollect({
    ...ride.fare,
    waiting: waiting ? waiting.fee : ride.fare.waiting,
  });

  return (
    <Screen
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
      footer={
        cancelling ? null : (
          <>
            {step ? (
              <Button
                title={step.button}
                big
                variant={step.action === 'complete' ? 'success' : 'primary'}
                icon={
                  step.action === 'arrive'
                    ? 'flag'
                    : step.action === 'start'
                      ? 'play'
                      : 'checkmark-done'
                }
                loading={act.isPending}
                onPress={onStep}
                style={{ minHeight: 76 }}
              />
            ) : null}
          </>
        )
      }
    >
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.status}>{step?.title ?? 'Safar'}</Text>
          <Muted>
            #{ride.number} · {PAYMENT_METHODS[ride.paymentMethod] ?? ride.paymentMethod}
          </Muted>
          {scheduled ? <Chip label={scheduled} tone="info" icon="calendar" /> : null}
        </View>
        <SosButton ride={ride} />
      </View>

      {step?.navigateTo ? (
        <Button
          title={step.navigateTo === 'pickup' ? 'Yo‘lovchiga yo‘l' : 'Manzilga yo‘l'}
          icon="navigate"
          big
          variant="secondary"
          onPress={() =>
            void navigateTo(
              target,
              step.navigateTo === 'pickup' ? 'Yo‘lovchiga yo‘l' : 'Manzilga yo‘l',
            )
          }
        />
      ) : null}

      {waiting ? (
        <Card
          style={{ borderColor: waiting.paid ? colors.warning : colors.success, borderWidth: 2 }}
        >
          <Text style={styles.waitLabel}>{waiting.paid ? 'Pullik kutish' : 'Bepul kutish'}</Text>
          <Text
            style={[styles.waitClock, { color: waiting.paid ? colors.warning : colors.success }]}
          >
            {waiting.paid
              ? clock(waiting.elapsedS - rules.freeMinutes * 60)
              : clock(waiting.freeLeftS)}
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
              text="Yo‘lovchi chiqmasa, bekor qilishda “Yo‘lovchi chiqmadi” ni tanlang — bekor qilish haqi sizga yoziladi."
            />
          )}
        </Card>
      ) : null}

      {ride.status === 'in_progress' || ride.status === 'driver_arrived' ? (
        <Card>
          <Text style={styles.waitLabel}>
            {ride.paymentMethod === 'cash'
              ? 'Yo‘lovchidan olinadi (naqd)'
              : 'Kartada oldindan to‘langan — balansingizga yoziladi'}
          </Text>
          <Text style={styles.collect} adjustsFontSizeToFit numberOfLines={1}>
            {digits(collect)} <Text style={styles.collectUnit}>so‘m</Text>
          </Text>
          {ride.paymentMethod === 'card' && collect > ride.fare.quoted ? (
            <Muted>Kutish {som(collect - ride.fare.quoted)} — yo‘lovchidan naqd oling</Muted>
          ) : collect !== ride.fare.quoted ? (
            <Muted>
              Narx {som(ride.fare.quoted)} + kutish {som(collect - ride.fare.quoted)}
            </Muted>
          ) : (
            <Muted>Narx oldindan belgilangan va o‘zgarmaydi</Muted>
          )}
        </Card>
      ) : null}

      <Card>
        <Place icon="radio-button-on" color={colors.brand} label="Qayerdan" place={ride.pickup} />
        <Place
          icon="flag"
          color={colors.text}
          label={`Qayerga · ${distance(ride.distanceM)}`}
          place={ride.dropoff}
        />
        {ride.options.length ? (
          <View style={styles.chips}>
            {ride.options.map((o) => (
              <Chip key={o} label={RIDE_OPTIONS[o] ?? o} tone="brand" />
            ))}
          </View>
        ) : null}
        {ride.comment ? <Text style={styles.comment}>“{ride.comment}”</Text> : null}
      </Card>

      {ride.rider ? (
        <Card>
          <View style={styles.riderRow}>
            <View style={{ flex: 1 }}>
              <Title>{ride.rider.name ?? 'Yo‘lovchi'}</Title>
              <Muted>
                {ride.rider.rating.toFixed(1)} ★
                {ride.channel === 'phone' ? ' · telefon orqali buyurtma' : ''}
              </Muted>
            </View>
            <Button
              title="Qo‘ng‘iroq"
              icon="call"
              variant="secondary"
              onPress={() => call(ride.rider?.phone)}
            />
          </View>
          {ride.rider.noShows > 0 ? (
            <Banner
              tone="warning"
              icon="warning"
              text={`Bu yo‘lovchi ${ride.rider.noShows} marta chiqmagan`}
            />
          ) : null}
        </Card>
      ) : null}

      {canCancel(ride.status) ? (
        cancelling ? (
          <CancelPanel
            ride={ride}
            noShowInS={waiting ? waiting.noShowInS : null}
            onClose={() => setCancelling(false)}
          />
        ) : (
          <Button
            title="Buyurtmani bekor qilish"
            icon="close-circle"
            variant="danger"
            onPress={() => setCancelling(true)}
          />
        )
      ) : (
        <Muted center>Safar boshlangan: muammo bo‘lsa operatorga qo‘ng‘iroq qiling.</Muted>
      )}
    </Screen>
  );
}

function Place(props: {
  icon: 'radio-button-on' | 'flag';
  color: string;
  label: string;
  place: DriverRide['pickup'];
}) {
  return (
    <View style={styles.place}>
      <Ionicons name={props.icon} size={22} color={props.color} />
      <View style={{ flex: 1 }}>
        <Text style={styles.placeLabel}>{props.label}</Text>
        <Text style={styles.placeText}>{props.place.address ?? 'Xaritadagi nuqta'}</Text>
        {props.place.landmark ? (
          <Text style={styles.landmark}>Mo‘ljal: {props.place.landmark}</Text>
        ) : null}
      </View>
    </View>
  );
}

function CancelPanel(props: { ride: DriverRide; noShowInS: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [note, setNote] = useState('');
  const choices = cancelChoices(props.ride.status, props.noShowInS);
  const [picked, setPicked] = useState<CancelReason | null>(null);
  const choice = choices.find((c) => c.code === picked) ?? null;

  const cancel = useMutation({
    mutationFn: (code: CancelReason) => {
      markRideEndedHere(props.ride.id);
      return driver.cancel(props.ride.id, code, note.trim() || null);
    },
    onSuccess: () => {
      haptics.success();
      qc.setQueryData(keys.current, null);
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.balance });
      router.replace('/home');
    },
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
        onPress={() => picked && cancel.mutate(picked)}
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
function SosButton(props: { ride: DriverRide }) {
  const send = useMutation({
    mutationFn: async () => {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 }).catch(() => null);
      return driver.sos(
        props.ride.id,
        last?.coords.latitude ?? null,
        last?.coords.longitude ?? null,
      );
    },
    onSuccess: () => {
      haptics.warning();
      Alert.alert(
        'Operatorlar xabardor qilindi',
        'Xavf bo‘lsa, darhol qo‘ng‘iroq qiling:',
        [
          ...EMERGENCY.map((e) => ({
            text: `${e.label} ${e.number}`,
            onPress: () => call(e.number),
          })),
        ].slice(0, 3),
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
      <Text style={styles.sosText}>SOS</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  status: { fontSize: 28, fontWeight: '900', color: colors.text },
  waitLabel: { fontSize: 15, fontWeight: '800', color: colors.muted, textTransform: 'uppercase' },
  waitClock: { fontSize: 64, fontWeight: '900', fontVariant: ['tabular-nums'] },
  collect: { fontSize: 64, fontWeight: '900', color: colors.brand, fontVariant: ['tabular-nums'] },
  collectUnit: { fontSize: 28, fontWeight: '800' },
  place: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  placeLabel: { fontSize: 14, color: colors.muted, fontWeight: '700' },
  placeText: { fontSize: 19, color: colors.text, fontWeight: '800' },
  landmark: { fontSize: 15, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  comment: { fontSize: 16, color: colors.text, fontStyle: 'italic' },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
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
