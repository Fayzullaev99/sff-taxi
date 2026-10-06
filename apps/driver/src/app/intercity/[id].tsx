import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { intercity } from '../../api/driver';
import type { DriverTrip, TripBooking } from '../../api/types';
import { keys, useDriverConfig, useTrip } from '../../data/queries';
import { errorMessage } from '../../lib/api-client';
import { formatPhone, som } from '../../lib/format';
import {
  alongStopLines,
  alongTheWayText,
  BOOKING_STATUS_TEXT,
  bookingMoney,
  TRIP_STATUS_TEXT,
  tripActions,
  tripEditable,
} from '../../lib/intercity';
import { minutesUntil, tashkentClock, whenLabel } from '../../lib/when';
import { call, navigateTo } from '../../ui/actions';
import {
  Banner,
  Button,
  Card,
  Chip,
  Choice,
  ErrorState,
  Field,
  Loading,
  Muted,
  Row,
  SectionTitle,
  Title,
} from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { Screen } from '../../ui/screen';
import { colors, radius, space } from '../../ui/theme';

const CANCEL_REASONS = [
  'Avtomobil nosoz',
  'Yo‘lovchi yetarli emas',
  'Ob-havo yoki yo‘l yopiq',
  'Shaxsiy sabab',
];

/** Re-renders every 30 s: "boarding opens in …", "leaves in …". */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * One departure with its passengers (names, phones, seats, pickup notes) and the one next
 * step: open boarding (an hour before), mark who is aboard, depart (the absent become
 * no-shows), arrive (each booking is charged tax and commission). Cancelling tells every
 * passenger and counts against reliability once seats are booked.
 */
export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const trip = useTrip(String(id));
  const rules = useDriverConfig().intercity;
  const now = useMinuteTick();
  const [cancelling, setCancelling] = useState(false);

  const update = (next: DriverTrip) => {
    qc.setQueryData(keys.trip(next.id), next);
    void qc.invalidateQueries({ queryKey: keys.trips });
  };
  const onError = (error: unknown) => {
    haptics.error();
    Alert.alert('Amal bajarilmadi', errorMessage(error));
    void trip.refetch();
  };

  const step = useMutation({
    mutationFn: (s: 'boarding' | 'depart' | 'arrive') => intercity.step(String(id), s),
    onSuccess: (next, s) => {
      haptics.success();
      update(next);
      if (s === 'arrive') {
        void qc.invalidateQueries({ queryKey: keys.balance });
        void qc.invalidateQueries({ queryKey: ['driver', 'earnings'] });
      }
    },
    onError,
  });
  const board = useMutation({
    mutationFn: (bookingId: string) => intercity.board(String(id), bookingId),
    onSuccess: (next) => {
      haptics.tap();
      update(next);
    },
    onError,
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => intercity.cancel(String(id), reason),
    onSuccess: (next) => {
      haptics.warning();
      setCancelling(false);
      update(next);
    },
    onError,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/intercity'));
  // loading and errors keep the header's back button (the stack header is hidden)
  if (!trip.data) {
    return (
      <Screen title="Qatnov" onBack={back}>
        {trip.isPending ? (
          <Loading />
        ) : (
          <ErrorState message={errorMessage(trip.error)} onRetry={() => void trip.refetch()} />
        )}
      </Screen>
    );
  }
  const t = trip.data;
  const actions = tripActions(t, now, rules.boardingOpensMinutes);
  const editable = tripEditable(t);
  const live = t.bookings.filter((b) => b.status !== 'cancelled');
  const cancelledBookings = t.bookings.filter((b) => b.status === 'cancelled');
  const leavesIn = minutesUntil(t.departureAt, now);
  const collected = t.bookings
    .filter((b) => b.status === 'completed')
    .reduce(
      (s, b) => ({
        cash: s.cash + bookingMoney(b).cash,
        commission: s.commission + b.commission,
        tax: s.tax + b.tax,
      }),
      { cash: 0, commission: 0, tax: 0 },
    );

  const confirmDepart = () =>
    Alert.alert(
      'Jo‘naysizmi?',
      actions.waiting
        ? `${actions.waiting} ta o‘rin egasi hali o‘tirmagan: ular “kelmadi” deb belgilanadi.`
        : 'Hamma yo‘lovchi mashinada.',
      [
        { text: 'Kutish', style: 'cancel' },
        { text: 'Jo‘nash', onPress: () => step.mutate('depart') },
      ],
    );
  const confirmArrive = () =>
    Alert.alert(
      'Yetib keldingizmi?',
      'Har bir yo‘lovchidan joy narxini naqd oling. Komissiya va soliq balansdan yechiladi.',
      [
        { text: 'Yo‘q', style: 'cancel' },
        { text: 'Yetib keldik', onPress: () => step.mutate('arrive') },
      ],
    );

  return (
    <Screen
      title={`Qatnov #${t.number}`}
      refreshing={trip.isRefetching}
      onRefresh={() => void trip.refetch()}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/intercity'))}
      footer={
        cancelling ? null : actions.canOpenBoarding ? (
          <Button
            title="Yo‘lovchilarni yig‘ish"
            icon="people"
            big
            loading={step.isPending}
            onPress={() => step.mutate('boarding')}
          />
        ) : t.status === 'boarding' ? (
          <Button
            title={actions.canDepart ? 'Jo‘nash' : 'Avval yo‘lovchini belgilang'}
            icon="car-sport"
            big
            variant="success"
            disabled={!actions.canDepart}
            loading={step.isPending}
            onPress={confirmDepart}
          />
        ) : actions.canArrive ? (
          <Button
            title="Yetib keldik"
            icon="flag"
            big
            variant="success"
            loading={step.isPending}
            onPress={confirmArrive}
          />
        ) : null
      }
    >
      <Card>
        <Text style={styles.route}>
          {t.from.nameUz} → {t.to.nameUz}
        </Text>
        <Text style={styles.when}>{whenLabel(t.departureAt, now)}</Text>
        <View style={styles.chips}>
          <Chip label={TRIP_STATUS_TEXT[t.status] ?? t.status} tone="brand" />
          <Chip
            label={`${t.seats.total - t.seats.free}/${t.seats.total} o‘rin band`}
            tone={t.seats.free < t.seats.total ? 'success' : 'neutral'}
          />
        </View>
        <Row label="Orqa o‘rindiq" value={som(t.price.rear)} />
        {t.seats.frontOffered ? (
          <Row
            label={`Old o‘rindiq${t.seats.frontFree ? '' : ' (band)'}`}
            value={som(t.price.front)}
          />
        ) : null}
        <Row label="Uchrashuv joyi" value={t.meetingPoint ?? t.from.meetingPoint ?? '—'} />
        {t.comment ? <Muted>“{t.comment}”</Muted> : null}
        {editable ? (
          <Button
            title="O‘zgartirish (vaqt, o‘rinlar, narx)"
            icon="create"
            variant="secondary"
            onPress={() => router.push(`/intercity/new?edit=${t.id}`)}
          />
        ) : null}
        {t.status === 'scheduled' || t.status === 'boarding' ? (
          <Button
            title="Uchrashuv joyiga yo‘l"
            icon="navigate"
            variant="secondary"
            onPress={() =>
              void navigateTo({ lat: t.from.lat, lng: t.from.lng }, t.meetingPoint ?? t.from.nameUz)
            }
          />
        ) : null}
      </Card>

      {t.status === 'cancelled' ? (
        <Banner
          tone="danger"
          icon="close-circle"
          title="Qatnov bekor qilingan"
          text={t.cancelReason ?? 'Sabab ko‘rsatilmagan'}
        />
      ) : null}
      {actions.boardingOpensAt ? (
        <Banner
          tone="info"
          icon="time"
          text={`Yo‘lovchilarni yig‘ish ${tashkentClock(actions.boardingOpensAt)} dan ochiladi${
            leavesIn !== null && leavesIn > 0 ? ` · jo‘nashga ${formatMinutes(leavesIn)}` : ''
          }.`}
        />
      ) : null}
      {t.status === 'boarding' ? (
        <Banner
          tone="warning"
          icon="people"
          text="Yo‘lovchi mashinaga o‘tirganda “O‘tirdi” ni bosing. Jo‘nashda o‘tirmaganlar “kelmadi” bo‘ladi."
        />
      ) : null}
      {t.status === 'arrived' ? (
        <Card>
          <Title>Natija</Title>
          <Row label="Yo‘lovchilardan naqd" value={som(collected.cash)} />
          <Row label="Komissiya" value={som(-collected.commission)} />
          <Row label="Soliq" value={som(-collected.tax)} />
          <Row
            label="Sof daromad"
            value={som(collected.cash - collected.commission - collected.tax)}
            strong
            tone="success"
          />
        </Card>
      ) : null}

      <SectionTitle>Yo‘lovchilar ({live.length})</SectionTitle>
      {!live.length ? (
        <Muted>
          Hali hech kim joy band qilmagan. Bron qilinsa, shu yerda ism va telefon ko‘rinadi.
          {editable ? ' Birinchi brongacha qatnovni o‘zgartirish mumkin.' : ''}
        </Muted>
      ) : null}
      {live.map((b) => (
        <BookingCard
          key={b.id}
          booking={b}
          // one at a time: the spinner shows on the passenger being marked
          canBoard={actions.canBoard && !board.isPending}
          boarding={board.isPending && board.variables === b.id}
          onBoard={() => board.mutate(b.id)}
        />
      ))}
      {cancelledBookings.length ? (
        <Muted>
          Bekor qilgan: {cancelledBookings.map((b) => b.riderName ?? `#${b.number}`).join(', ')}
        </Muted>
      ) : null}

      {actions.canCancel ? (
        cancelling ? (
          <CancelCard
            loading={cancel.isPending}
            booked={live.length > 0}
            onCancel={(reason) => cancel.mutate(reason)}
            onBack={() => setCancelling(false)}
          />
        ) : (
          <Button
            title="Qatnovni bekor qilish"
            icon="close-circle"
            variant="danger"
            onPress={() => setCancelling(true)}
          />
        )
      ) : null}
    </Screen>
  );
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} daqiqa`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} soat ${rest} daqiqa` : `${h} soat`;
}

function BookingCard(props: {
  booking: TripBooking;
  canBoard: boolean;
  boarding: boolean;
  onBoard: () => void;
}) {
  const b = props.booking;
  const money = bookingMoney(b);
  const along = alongTheWayText(b);
  const tone =
    b.status === 'boarded' || b.status === 'completed'
      ? 'success'
      : b.status === 'no_show'
        ? 'danger'
        : 'brand';
  return (
    <Card>
      <View style={styles.bookingHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name}>{b.riderName ?? 'Yo‘lovchi'}</Text>
          {b.riderPhone ? <Text style={styles.phone}>{formatPhone(b.riderPhone)}</Text> : null}
        </View>
        <Chip label={BOOKING_STATUS_TEXT[b.status] ?? b.status} tone={tone} />
      </View>
      <View style={styles.chips}>
        <Chip label={`${b.seats} o‘rin`} tone="neutral" icon="person" />
        {b.front ? <Chip label="Old o‘rindiq" tone="info" /> : null}
        {b.channel === 'phone' ? <Chip label="Operator orqali" tone="neutral" /> : null}
        <Chip label={`Naqd: ${som(money.cash)}`} tone="success" icon="cash" />
        {money.deposit > 0 ? (
          <Chip label={`${som(money.deposit)} oldindan to‘langan`} tone="info" icon="card" />
        ) : null}
      </View>
      {along ? (
        <View style={styles.note}>
          <Ionicons name="git-branch" size={18} color={colors.brand} />
          <Text style={styles.noteText}>Yo‘l ustida: {along}</Text>
        </View>
      ) : null}
      {alongStopLines(b).map((line) => (
        <View key={line} style={styles.note}>
          <Ionicons name="flag-outline" size={18} color={colors.brand} />
          <Text style={styles.noteText}>{line}</Text>
        </View>
      ))}
      {b.pickupNote ? (
        <View style={styles.note}>
          <Ionicons name="location" size={18} color={colors.brand} />
          <Text style={styles.noteText}>{b.pickupNote}</Text>
        </View>
      ) : null}
      <View style={styles.pair}>
        {b.riderPhone ? (
          <Button
            title="Qo‘ng‘iroq"
            icon="call"
            variant="secondary"
            onPress={() => call(b.riderPhone)}
            style={{ flex: 1 }}
          />
        ) : null}
        {props.canBoard && b.status === 'booked' ? (
          <Button
            title="O‘tirdi"
            icon="checkmark"
            variant="success"
            loading={props.boarding}
            onPress={props.onBoard}
            style={{ flex: 1 }}
          />
        ) : null}
      </View>
    </Card>
  );
}

function CancelCard(props: {
  loading: boolean;
  booked: boolean;
  onCancel: (reason: string) => void;
  onBack: () => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const reason = (choice === 'other' ? other : (choice ?? '')).trim();
  return (
    <Card style={{ borderColor: colors.danger }}>
      <Title>Nega bekor qilasiz?</Title>
      {props.booked ? (
        <Banner
          tone="warning"
          icon="alert-circle"
          text="Yo‘lovchilarga xabar boriladi. Joy band qilingan qatnovni bekor qilish ishonchlilik ko‘rsatkichingizni pasaytiradi."
        />
      ) : null}
      <Choice
        options={[
          ...CANCEL_REASONS.map((r) => ({ value: r, label: r })),
          { value: 'other', label: 'Boshqa' },
        ]}
        selected={choice ? [choice] : []}
        onToggle={setChoice}
      />
      {choice === 'other' ? (
        <Field label="Sabab" value={other} onChangeText={setOther} maxLength={300} />
      ) : null}
      <Button
        title="Bekor qilish"
        icon="close-circle"
        variant="danger"
        disabled={reason.length < 3}
        loading={props.loading}
        onPress={() => props.onCancel(reason)}
      />
      <Button title="Orqaga" variant="ghost" onPress={props.onBack} />
    </Card>
  );
}

const styles = StyleSheet.create({
  route: { fontSize: 24, fontWeight: '900', color: colors.text },
  when: { fontSize: 19, fontWeight: '800', color: colors.brand },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  bookingHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: 18, fontWeight: '800', color: colors.text },
  phone: { fontSize: 16, color: colors.muted, fontVariant: ['tabular-nums'] },
  note: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  noteText: { flex: 1, color: colors.text, fontSize: 15 },
  pair: { flexDirection: 'row', gap: space.sm },
});
