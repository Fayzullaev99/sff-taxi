import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { intercity } from '../../api/driver';
import type { DriverTrip, TripBooking } from '../../api/types';
import { keys, useDriverConfig, useTrip } from '../../data/queries';
import { type TKey, useT } from '../../i18n';
import { errorMessage } from '../../lib/api-client';
import { formatPhone, som } from '../../lib/format';
import {
  alongStopLines,
  alongTheWayText,
  BOOKING_STATUS_TEXT,
  bookingMoney,
  townName,
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

/** The ready-made cancel reasons; the Uzbek text is what the API receives (see CancelCard). */
const CANCEL_REASONS: TKey[] = [
  'intercity.trip.cancelReasons.vehicle',
  'intercity.trip.cancelReasons.fewRiders',
  'intercity.trip.cancelReasons.weather',
  'intercity.trip.cancelReasons.personal',
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
  const { t } = useT();
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
    Alert.alert(t('intercity.trip.actionFailed'), errorMessage(error));
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
      <Screen title={t('intercity.trip.title')} onBack={back}>
        {trip.isPending ? (
          <Loading />
        ) : (
          <ErrorState message={errorMessage(trip.error)} onRetry={() => void trip.refetch()} />
        )}
      </Screen>
    );
  }
  const x = trip.data;
  const actions = tripActions(x, now, rules.boardingOpensMinutes);
  const editable = tripEditable(x);
  const live = x.bookings.filter((b) => b.status !== 'cancelled');
  const cancelledBookings = x.bookings.filter((b) => b.status === 'cancelled');
  const leavesIn = minutesUntil(x.departureAt, now);
  const collected = x.bookings
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
      t('intercity.trip.departConfirm'),
      actions.waiting
        ? t('intercity.trip.departWaiting', { count: actions.waiting })
        : t('intercity.trip.departAll'),
      [
        { text: t('intercity.trip.wait'), style: 'cancel' },
        { text: t('intercity.trip.depart'), onPress: () => step.mutate('depart') },
      ],
    );
  const confirmArrive = () =>
    Alert.alert(t('intercity.trip.arriveConfirm'), t('intercity.trip.arriveText'), [
      { text: t('common.actions.no'), style: 'cancel' },
      { text: t('intercity.trip.arrived'), onPress: () => step.mutate('arrive') },
    ]);

  const formatMinutes = (m: number): string => {
    if (m < 60) return t('intercity.trip.minutes', { count: m });
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest
      ? t('intercity.trip.hoursMinutes', { hours: h, minutes: rest })
      : t('intercity.trip.hours', { count: h });
  };

  return (
    <Screen
      title={t('intercity.trip.numbered', { number: x.number })}
      refreshing={trip.isRefetching}
      onRefresh={() => void trip.refetch()}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/intercity'))}
      footer={
        cancelling ? null : actions.canOpenBoarding ? (
          <Button
            title={t('intercity.trip.openBoarding')}
            icon="people"
            big
            loading={step.isPending}
            onPress={() => step.mutate('boarding')}
          />
        ) : x.status === 'boarding' ? (
          <Button
            title={actions.canDepart ? t('intercity.trip.depart') : t('intercity.trip.markFirst')}
            icon="car-sport"
            big
            variant="success"
            disabled={!actions.canDepart}
            loading={step.isPending}
            onPress={confirmDepart}
          />
        ) : actions.canArrive ? (
          <Button
            title={t('intercity.trip.arrived')}
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
          {townName(x.from)} → {townName(x.to)}
        </Text>
        <Text style={styles.when}>{whenLabel(x.departureAt, now)}</Text>
        <View style={styles.chips}>
          <Chip label={TRIP_STATUS_TEXT[x.status] ?? x.status} tone="brand" />
          <Chip
            label={t('intercity.seats.booked', {
              booked: x.seats.total - x.seats.free,
              total: x.seats.total,
            })}
            tone={x.seats.free < x.seats.total ? 'success' : 'neutral'}
          />
        </View>
        <Row label={t('intercity.seats.rear')} value={som(x.price.rear)} />
        {x.seats.frontOffered ? (
          <Row
            label={x.seats.frontFree ? t('intercity.seats.front') : t('intercity.seats.frontTaken')}
            value={som(x.price.front)}
          />
        ) : null}
        <Row
          label={t('intercity.trip.meetingPoint')}
          value={x.meetingPoint ?? x.from.meetingPoint ?? '—'}
        />
        {x.comment ? <Muted>“{x.comment}”</Muted> : null}
        {editable ? (
          <Button
            title={t('intercity.trip.edit')}
            icon="create"
            variant="secondary"
            onPress={() => router.push(`/intercity/new?edit=${x.id}`)}
          />
        ) : null}
        {x.status === 'scheduled' || x.status === 'boarding' ? (
          <Button
            title={t('intercity.trip.navigate')}
            icon="navigate"
            variant="secondary"
            onPress={() =>
              void navigateTo(
                { lat: x.from.lat, lng: x.from.lng },
                x.meetingPoint ?? townName(x.from),
              )
            }
          />
        ) : null}
      </Card>

      {x.status === 'cancelled' ? (
        <Banner
          tone="danger"
          icon="close-circle"
          title={t('intercity.trip.cancelledTitle')}
          text={x.cancelReason ?? t('intercity.trip.noReason')}
        />
      ) : null}
      {actions.boardingOpensAt ? (
        <Banner
          tone="info"
          icon="time"
          text={
            leavesIn !== null && leavesIn > 0
              ? t('intercity.trip.boardingOpensAtLeaves', {
                  time: tashkentClock(actions.boardingOpensAt),
                  left: formatMinutes(leavesIn),
                })
              : t('intercity.trip.boardingOpensAt', {
                  time: tashkentClock(actions.boardingOpensAt),
                })
          }
        />
      ) : null}
      {x.status === 'boarding' ? (
        <Banner tone="warning" icon="people" text={t('intercity.trip.boardingHint')} />
      ) : null}
      {x.status === 'arrived' ? (
        <Card>
          <Title>{t('intercity.trip.result')}</Title>
          <Row label={t('intercity.trip.cashFromRiders')} value={som(collected.cash)} />
          <Row label={t('intercity.trip.commission')} value={som(-collected.commission)} />
          <Row label={t('intercity.trip.tax')} value={som(-collected.tax)} />
          <Row
            label={t('intercity.trip.net')}
            value={som(collected.cash - collected.commission - collected.tax)}
            strong
            tone="success"
          />
        </Card>
      ) : null}

      <SectionTitle>{t('intercity.trip.passengers', { count: live.length })}</SectionTitle>
      {!live.length ? (
        <Muted>
          {t('intercity.trip.noBookings')}
          {editable ? ` ${t('intercity.trip.noBookingsEditable')}` : ''}
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
          {t('intercity.trip.cancelledBy', {
            names: cancelledBookings.map((b) => b.riderName ?? `#${b.number}`).join(', '),
          })}
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
            title={t('intercity.trip.cancelTrip')}
            icon="close-circle"
            variant="danger"
            onPress={() => setCancelling(true)}
          />
        )
      ) : null}
    </Screen>
  );
}

function BookingCard(props: {
  booking: TripBooking;
  canBoard: boolean;
  boarding: boolean;
  onBoard: () => void;
}) {
  const { t } = useT();
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
          <Text style={styles.name}>{b.riderName ?? t('intercity.bookings.passenger')}</Text>
          {b.riderPhone ? <Text style={styles.phone}>{formatPhone(b.riderPhone)}</Text> : null}
        </View>
        <Chip label={BOOKING_STATUS_TEXT[b.status] ?? b.status} tone={tone} />
      </View>
      <View style={styles.chips}>
        <Chip label={t('intercity.seats.count', { count: b.seats })} tone="neutral" icon="person" />
        {b.front ? <Chip label={t('intercity.seats.front')} tone="info" /> : null}
        {b.channel === 'phone' ? (
          <Chip label={t('intercity.bookings.viaOperator')} tone="neutral" />
        ) : null}
        <Chip
          label={t('intercity.bookings.cash', { amount: som(money.cash) })}
          tone="success"
          icon="cash"
        />
        {money.deposit > 0 ? (
          <Chip
            label={t('intercity.bookings.prepaid', { amount: som(money.deposit) })}
            tone="info"
            icon="card"
          />
        ) : null}
      </View>
      {along ? (
        <View style={styles.note}>
          <Ionicons name="git-branch" size={18} color={colors.brand} />
          <Text style={styles.noteText}>
            {t('intercity.bookings.alongTheWay', { route: along })}
          </Text>
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
            title={t('intercity.bookings.call')}
            icon="call"
            variant="secondary"
            onPress={() => call(b.riderPhone)}
            style={{ flex: 1 }}
          />
        ) : null}
        {props.canBoard && b.status === 'booked' ? (
          <Button
            title={t('intercity.bookings.boarded')}
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
  const { t } = useT();
  const [choice, setChoice] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const reason = (choice === 'other' ? other : (choice ?? '')).trim();
  return (
    <Card style={{ borderColor: colors.danger }}>
      <Title>{t('intercity.trip.whyCancel')}</Title>
      {props.booked ? (
        <Banner tone="warning" icon="alert-circle" text={t('intercity.trip.cancelWarning')} />
      ) : null}
      <Choice
        options={[
          // the reason sent to the API (and shown to the riders) stays the Uzbek text,
          // whatever language the driver reads the choices in
          ...CANCEL_REASONS.map((key) => ({ value: t(key, undefined, 'uz'), label: t(key) })),
          { value: 'other', label: t('intercity.trip.cancelReasons.otherReason') },
        ]}
        selected={choice ? [choice] : []}
        onToggle={setChoice}
      />
      {choice === 'other' ? (
        <Field
          label={t('intercity.trip.reason')}
          value={other}
          onChangeText={setOther}
          maxLength={300}
        />
      ) : null}
      <Button
        title={t('common.actions.cancel')}
        icon="close-circle"
        variant="danger"
        disabled={reason.length < 3}
        loading={props.loading}
        onPress={() => props.onCancel(reason)}
      />
      <Button title={t('common.actions.back')} variant="ghost" onPress={props.onBack} />
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
