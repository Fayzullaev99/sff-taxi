import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import { keys, useBooking } from '../../../api/queries';
import { useIntercityRules } from '../../../api/support';
import { useLiveRides } from '../../../api/realtime';
import { useT } from '../../../i18n';
import { confirm } from '../../../lib/dialogs';
import { formatDateTime, formatMoney, formatPhone } from '../../../lib/format';
import {
  bookingCancelledText,
  bookingCancelTerms,
  bookingStatusLabel,
  cancelRulesFrom,
  stopLines,
  townName,
  tripStatusLabel,
} from '../../../lib/intercity';
import { useNow } from '../../../lib/hooks';
import { callPhone } from '../../../lib/links';
import { bookingDepositRules } from '../../../lib/deposit';
import { CheckoutPanel } from '../../../ride/PaymentPanel';
import { Banner, Button, Card, IconButton, KeyValue, T } from '../../../ui/primitives';
import { ErrorView, LoadingView } from '../../../ui/states';
import { colors, radius, space } from '../../../ui/theme';

/**
 * A booking: the departure, the meeting point, and once booked the driver's name, phone
 * and plate; cancelling says its price first (free until 60 minutes before departure).
 */
/** How long an unpaid booking holds its seats (the API's default payment_minutes). */
const PAYMENT_MINUTES = 15;

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  useLiveRides();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useBooking(id);
  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configRules = useIntercityRules();
  const b = query.data;

  if (!b) {
    return query.isError ? (
      <ErrorView error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <LoadingView />
    );
  }

  const trip = b.trip;
  // the booking's own rules and times (the API's), /config for an older API, else defaults
  const rules = cancelRulesFrom(b.cancelRules, configRules);
  const deposit = b.depositAmount ?? 0;
  const unpaid = b.status === 'awaiting_payment';
  const terms = bookingCancelTerms(trip.departureAt, b.price, now, rules, {
    freeUntil: b.cancelFreeUntil,
    feeNow: b.cancelFeeNow,
    deposit: unpaid ? 0 : deposit,
    unpaid,
  });
  const ended = bookingCancelledText(b);

  const cancel = async () => {
    const ok = await confirm({
      title: t('intercity.booking.cancelTitle'),
      message: terms.message,
      confirmText:
        terms.fee > 0
          ? t('intercity.booking.cancelWithFee', { fee: formatMoney(terms.fee) })
          : t('common.actions.cancel'),
      cancelText: t('intercity.booking.keep'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await endpoints.cancelBooking(b.id, null);
      queryClient.setQueryData(keys.booking(b.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.bookings });
      void queryClient.invalidateQueries({ queryKey: keys.intercityTrip(trip.id) });
      void queryClient.invalidateQueries({ queryKey: ['intercity-trips'] });
    } catch (e) {
      setError(describeError(e));
      void query.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(8) }]}
    >
      <View style={styles.head}>
        <T variant="h1" accessibilityRole="header">
          {townName(trip.from)} → {townName(trip.to)}
        </T>
        <T variant="h3">{formatDateTime(trip.departureAt)}</T>
        <T variant="smallStrong" color={b.status === 'booked' ? colors.success : colors.textMuted}>
          {t('intercity.booking.number', { number: b.number })} · {bookingStatusLabel(b.status)}
          {trip.status !== 'scheduled' && trip.status !== 'cancelled'
            ? ` · ${tripStatusLabel(trip.status)}`
            : ''}
        </T>
      </View>

      {unpaid ? (
        <CheckoutPanel
          payment={b.payment ?? null}
          amount={b.payment?.amount ?? deposit}
          label={t('intercity.deposit.title')}
          cashLeft={b.payCash ?? b.price - deposit}
          info={bookingDepositRules(
            { deposit, cash: b.payCash ?? b.price - deposit },
            PAYMENT_MINUTES,
            rules.freeCancelMinutes,
          )}
          expiredText={t('intercity.deposit.expired')}
          waitingText={t('intercity.deposit.waiting')}
          onCheck={() => query.refetch()}
        />
      ) : null}

      {ended ? <Banner tone={b.status === 'no_show' ? 'warning' : 'info'} message={ended} /> : null}

      {b.contact ? (
        <Card style={styles.card}>
          <View style={styles.contact}>
            <View
              style={styles.plate}
              accessible
              accessibilityLabel={t('intercity.booking.plateA11y', {
                plate: b.contact.plateFormatted.split('').join(' '),
              })}
            >
              <T variant="plate" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {b.contact.plateFormatted}
              </T>
            </View>
            <View style={styles.flex}>
              <T variant="small" color={colors.textMuted} numberOfLines={2}>
                {trip.vehicle.colour} {trip.vehicle.make} {trip.vehicle.model}
              </T>
            </View>
          </View>
          <View style={styles.contact}>
            <View style={styles.flex}>
              <T variant="bodyStrong">{b.contact.driverName}</T>
              {b.contact.driverPhone ? (
                <T variant="small" color={colors.textMuted}>
                  {formatPhone(b.contact.driverPhone)}
                </T>
              ) : null}
            </View>
            {b.contact.driverPhone ? (
              <IconButton
                name="call"
                label={t('intercity.booking.callDriver', { name: b.contact.driverName })}
                size={52}
                color={colors.ink}
                background={colors.brand}
                onPress={() => void callPhone(b.contact!.driverPhone!)}
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      <Card style={styles.card}>
        {b.alongTheWay && b.pickup && b.dropoff ? (
          <KeyValue
            label={t('intercity.booking.alongTheWay')}
            value={`${townName(b.pickup)} → ${townName(b.dropoff)}`}
          />
        ) : null}
        {stopLines(b, trip).map((line) => (
          <KeyValue key={line.label} label={line.label} value={line.value} />
        ))}
        <KeyValue
          label={t('intercity.booking.seats')}
          value={
            b.front ? t('intercity.booking.seatsOneFront', { seats: b.seats }) : String(b.seats)
          }
        />
        {deposit > 0 ? (
          <>
            <KeyValue label={t('intercity.booking.price')} value={formatMoney(b.price)} strong />
            <KeyValue
              label={
                unpaid ? t('intercity.booking.depositUnpaid') : t('intercity.booking.depositPaid')
              }
              value={formatMoney(deposit)}
            />
            <KeyValue
              label={t('intercity.booking.cashToDriver')}
              value={formatMoney(b.payCash ?? b.price - deposit)}
            />
          </>
        ) : (
          <KeyValue label={t('intercity.booking.priceCash')} value={formatMoney(b.price)} strong />
        )}
        {b.pickupNote ? (
          <KeyValue label={t('intercity.booking.yourNote')} value={b.pickupNote} />
        ) : null}
        {b.cancellationFee > 0 ? (
          <KeyValue
            label={t('intercity.booking.cancellationFee')}
            value={formatMoney(b.cancellationFee)}
            valueColor={colors.warning}
          />
        ) : null}
      </Card>

      {b.canCancel ? (
        <>
          <Banner tone={terms.fee > 0 ? 'warning' : 'info'} message={terms.message} />
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button
            title={t('intercity.booking.cancelAction')}
            variant="danger"
            loading={busy}
            onPress={() => void cancel()}
          />
        </>
      ) : null}

      <Button
        title={t('intercity.booking.otherTrips')}
        variant="secondary"
        onPress={() => router.replace('/intercity')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3) },
  head: { gap: space(1) },
  card: { gap: space(2) },
  flex: { flex: 1, minWidth: 0 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  plate: {
    borderWidth: 2.5,
    borderColor: colors.ink,
    borderRadius: radius.sm,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
    backgroundColor: colors.bg,
    maxWidth: '60%',
  },
});
