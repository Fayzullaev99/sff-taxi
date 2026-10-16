import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, describeError, isOffline } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import { keys, useIntercityTrip } from '../../../api/queries';
import { useIntercityRules } from '../../../api/support';
import { useT } from '../../../i18n';
import { formatDateTime, formatMoney } from '../../../lib/format';
import {
  alongParams,
  bookingPrice,
  cancelRulesFrom,
  cancelRuleText,
  frontSurcharge,
  MAX_SEATS,
  stopLines,
  townName,
  tripStatusLabel,
} from '../../../lib/intercity';
import { OrderAttempts } from '../../../lib/order-attempt';
import { bookingDeposit, bookingDepositRules } from '../../../lib/deposit';
import { Banner, Button, Card, KeyValue, Stepper, T, TextField } from '../../../ui/primitives';
import { formatRating } from '../../../ui/Rating';
import { ErrorView, LoadingView } from '../../../ui/states';
import { colors, space } from '../../../ui/theme';
import { KeyboardAvoider } from '../../../ui/KeyboardAvoider';

/**
 * One departure: when and where it leaves, the car and the driver (first name only until
 * booked), the seat prices; the rider picks seats (the front one costs more) and books.
 * One clientRequestId per attempt: a retry after a timeout never books twice.
 */
export default function TripScreen() {
  const params = useLocalSearchParams<{
    id: string;
    seats?: string;
    /** A result along the way: the rider's towns and the price of their part. */
    along?: string;
    from?: string;
    to?: string;
    fromName?: string;
    toName?: string;
    rear?: string;
    front?: string;
    boardName?: string;
    boardMeet?: string;
    boardAt?: string;
    alightName?: string;
    alightMeet?: string;
    partM?: string;
  }>();
  const { t } = useT();
  const along = alongParams(params);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useIntercityTrip(params.id);
  const configRules = useIntercityRules();
  const trip = query.data;
  const attempts = useRef(new OrderAttempts(() => Crypto.randomUUID())).current;
  const [seats, setSeats] = useState(Math.max(1, Math.min(MAX_SEATS, Number(params.seats) || 1)));
  const [front, setFront] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const free = trip?.seats.free ?? 0;
  const frontFree = trip?.seats.frontFree ?? false;
  // keep the choice possible as seats go (other riders book meanwhile)
  useEffect(() => {
    if (trip && seats > Math.max(1, free)) setSeats(Math.max(1, free));
    if (trip && front && !frontFree) setFront(false);
  }, [trip, free, frontFree, seats, front]);

  if (!trip) {
    return query.isError ? (
      <ErrorView error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <LoadingView />
    );
  }

  const open = trip.status === 'scheduled' || trip.status === 'boarding';
  const departed = new Date(trip.departureAt).getTime() <= Date.now();
  // along the way the seats cost the rider's part of the trip (as the search priced it)
  const prices = along?.prices ?? trip.price;
  const price = bookingPrice(seats, front, prices);
  const surcharge = frontSurcharge(prices);
  const deposit = bookingDeposit(price, trip.depositRules);
  const cancelRules = cancelRulesFrom(trip.cancelRules, configRules);

  const book = async () => {
    const input = {
      seats,
      front,
      pickupNote: note.trim() || null,
      ...(along ? { from: along.from, to: along.to } : {}),
    };
    const clientRequestId = attempts.idFor(JSON.stringify([trip.id, input]));
    setBusy(true);
    setError(null);
    try {
      const { data: booking } = await endpoints.book(trip.id, { ...input, clientRequestId });
      attempts.settle('created');
      queryClient.setQueryData(keys.booking(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: keys.bookings });
      void queryClient.invalidateQueries({ queryKey: ['intercity-trips'] });
      void queryClient.invalidateQueries({ queryKey: keys.intercityTrip(trip.id) });
      router.replace({ pathname: '/intercity/booking/[id]', params: { id: booking.id } });
    } catch (e) {
      if (isOffline(e) || (e instanceof ApiError && e.status >= 500)) {
        // the booking may exist: the same clientRequestId returns it, never a second one
        attempts.settle('unknown');
        setError(isOffline(e) ? t('intercity.trip.offlineRetry') : describeError(e));
      } else {
        attempts.settle('rejected');
        setError(describeError(e));
        // seats may have gone: show the trip as it is now
        void query.refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoider style={styles.root} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <T variant="h1" accessibilityRole="header">
            {townName(trip.from)} → {townName(trip.to)}
          </T>
          <T variant="h3">{formatDateTime(trip.departureAt)}</T>
          {along ? (
            <T variant="smallStrong" color={colors.brandText}>
              {t('intercity.trip.alongLine', { from: along.fromName, to: along.toName })}
            </T>
          ) : null}
          {!open ? (
            <T variant="smallStrong" color={colors.warning}>
              {tripStatusLabel(trip.status)}
            </T>
          ) : null}
        </View>

        {trip.myBookingId ? (
          <Banner
            tone="info"
            title={t('intercity.trip.hasBooking')}
            action={
              <Button
                title={t('intercity.trip.viewBooking')}
                size="sm"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/intercity/booking/[id]',
                    params: { id: trip.myBookingId! },
                  })
                }
              />
            }
          />
        ) : null}

        <Card style={styles.card}>
          {stopLines({ alongTheWay: Boolean(along?.stops), ...along?.stops }, trip).map((line) => (
            <KeyValue key={line.label} label={line.label} value={line.value} />
          ))}
          <KeyValue
            label={t('intercity.trip.car')}
            value={`${trip.vehicle.colour} ${trip.vehicle.make} ${trip.vehicle.model} · ${t(`common.classes.${trip.class}`)}`}
          />
          <KeyValue
            label={t('intercity.trip.driver')}
            value={`${trip.driver.name} · ★ ${formatRating(trip.driver.rating)} · ${t('intercity.trip.rides', { count: trip.driver.ridesCompleted })}`}
          />
          {trip.comment ? (
            <T variant="small" color={colors.textMuted}>
              {trip.comment}
            </T>
          ) : null}
          <T variant="small" color={colors.textMuted}>
            {t('intercity.trip.contactAfterBooking')}
          </T>
        </Card>

        {open && !departed ? (
          <>
            <Card style={styles.card}>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <T variant="bodyStrong">{t('intercity.seats.count')}</T>
                  <T variant="small" color={colors.textMuted}>
                    {t('intercity.seats.freeRear', { count: free, rear: formatMoney(prices.rear) })}
                  </T>
                </View>
                <Stepper
                  value={seats}
                  min={1}
                  max={Math.max(1, Math.min(MAX_SEATS, free))}
                  onChange={setSeats}
                />
              </View>
              {trip.seats.frontOffered ? (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: front, disabled: !frontFree }}
                  accessibilityLabel={t(
                    frontFree ? 'intercity.seats.frontA11y' : 'intercity.seats.frontA11yTaken',
                    { price: formatMoney(prices.front) },
                  )}
                  disabled={!frontFree}
                  onPress={() => setFront(!front)}
                  style={[styles.row, !frontFree ? styles.dim : null]}
                >
                  <View style={styles.flex}>
                    <T variant="bodyStrong">{t('intercity.seats.front')}</T>
                    <T variant="small" color={colors.textMuted}>
                      {!frontFree
                        ? t('intercity.seats.frontTaken')
                        : surcharge
                          ? t('intercity.seats.frontPriceSurcharge', {
                              price: formatMoney(prices.front),
                              surcharge: formatMoney(surcharge),
                            })
                          : t('intercity.seats.frontPrice', { price: formatMoney(prices.front) })}
                    </T>
                  </View>
                  <Switch
                    value={front}
                    disabled={!frontFree}
                    onValueChange={setFront}
                    trackColor={{ true: colors.brand, false: colors.border }}
                    thumbColor={front ? colors.ink : colors.bg}
                    importantForAccessibility="no"
                  />
                </Pressable>
              ) : null}
            </Card>

            <TextField
              label={t('intercity.trip.noteLabel')}
              placeholder={t('intercity.trip.notePlaceholder')}
              value={note}
              onChangeText={setNote}
              maxLength={300}
              multiline
            />

            {deposit ? (
              <Banner
                tone="info"
                icon="card-outline"
                title={t('intercity.deposit.title')}
                message={bookingDepositRules(
                  deposit,
                  trip.depositRules?.paymentMinutes ?? 15,
                  cancelRules.freeCancelMinutes,
                )}
              />
            ) : (
              <Banner
                tone="info"
                icon="information-circle-outline"
                message={cancelRuleText(cancelRules)}
              />
            )}
            <T variant="small" color={colors.textMuted}>
              {deposit ? t('intercity.trip.fixedPrice') : t('intercity.trip.cashFixedPrice')}
            </T>
          </>
        ) : (
          <Banner tone="warning" message={t('intercity.trip.closed')} />
        )}
      </ScrollView>

      {open && !departed ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space(3)) }]}>
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button
            title={
              deposit
                ? t('intercity.trip.bookWithDeposit', { deposit: formatMoney(deposit.deposit) })
                : seats > 1
                  ? t('intercity.trip.bookSeats', { count: seats })
                  : t('intercity.trip.book')
            }
            size="lg"
            trailing={deposit ? undefined : formatMoney(price)}
            loading={busy}
            disabled={free < 1}
            onPress={() => void book()}
          />
        </View>
      ) : null}
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3), paddingBottom: space(8) },
  head: { gap: space(1) },
  card: { gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 52 },
  flex: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.5 },
  footer: {
    paddingHorizontal: space(4),
    paddingTop: space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    gap: space(2),
  },
});
