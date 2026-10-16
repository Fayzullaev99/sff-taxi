import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, describeError } from '../api/client';
import { useAppConfig, useMe, useQuote, useTariffAt } from '../api/queries';
import { useFeature } from '../api/support';
import type { Quote, RideClass } from '../api/types';
import { useT } from '../i18n';
import {
  orderableClass,
  owedFeeLabel,
  quoteOwedFee,
  rideClassLabel,
  seatShareText,
  stopRulesText,
} from '../lib/fare';
import { formatDateTime, formatDistance, formatMoney } from '../lib/format';
import { cardLabel } from '../lib/payment';
import { availabilityText } from '../lib/ride-state';
import { schedulable, SCHEDULE_DISPATCH_BEFORE_MIN } from '../lib/schedule';
import { ClassCards } from '../order/ClassCards';
import { OrderOptions } from '../order/OrderOptions';
import { PassengersRow, RouteModeChoice, SharingRows } from '../order/RideChoices';
import { orderChoices, routePrices, seatTotal, sharedFloor } from '../lib/sharing';
import { RIDE_FREE_CANCEL_MINUTES, rideDeposit, rideDepositRules } from '../lib/deposit';
import { ParcelFields, parcelErrors } from '../order/ParcelFields';
import { PassengerFields } from '../order/PassengerFields';
import { checkPassenger } from '../lib/passenger';
import { classDiscount, orderDiscount } from '../lib/promo';
import { PromoRow } from '../order/PromoRow';
import { useOrderSubmit } from '../order/useOrderSubmit';
import { RouteCard } from '../order/RouteCard';
import { ScheduleSheet } from '../ride/ScheduleSheet';
import { toggleOption, updateDraft, useDraft } from '../trip/draft';
import { Banner, Button, Card, Icon, Segmented, T, TextField } from '../ui/primitives';
import { ErrorView, Skeleton } from '../ui/states';
import { colors, radius, space } from '../ui/theme';
import { KeyboardAvoider } from '../ui/KeyboardAvoider';

/** Stable, so the memoised class cards re-render only when their quote or choice changes. */
const selectClass = (rideClass: RideClass) => updateDraft({ rideClass });

type Translate = ReturnType<typeof useT>['t'];

/**
 * Tariff choice: fixed prices of every class switched on for this route (quoted by the
 * API, no surge; a horizontal row of class cards), options, the landmark and a comment for the driver, the payment method, then
 * the order — with one clientRequestId per attempt, so retries never order twice.
 */
export default function OrderScreen() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const draft = useDraft();
  const { pickup, dropoff } = draft;
  const later = draft.scheduledFor;
  // a parcel carried by a taxi car is priced here too; cargo has its own screen
  const delivery = draft.service === 'delivery';
  const quote = useQuote(
    pickup,
    dropoff,
    draft.options,
    later,
    delivery ? 'delivery' : 'taxi',
    draft.service !== 'cargo',
    draft.stops,
  );
  const [triedOrder, setTriedOrder] = useState(false);
  const tariff = useTariffAt(pickup);
  const config = useAppConfig().data;
  const schedulingOn = useFeature('scheduledRides');
  const order = useOrderSubmit(() => void quote.refetch());
  const { busy, error, setError, leaving } = order;
  const [pickingTime, setPickingTime] = useState(false);
  const [useCredit, setUseCredit] = useState(true);

  // nothing to price (the app was restored here): back to the map
  useEffect(() => {
    if (!leaving.current && (!pickup || !dropoff)) router.replace('/home');
    else if (!leaving.current && draft.service === 'cargo') router.replace('/cargo');
  }, [pickup, dropoff, draft.service]);

  const q = quote.data;
  // the previous quote stays on screen while a new one loads (other options, another
  // time): it must not be ordered, the API would take its options and its time
  const stale = quote.isPlaceholderData;
  const fare = q?.fares[draft.rideClass];
  // wave 4 (people, sharing, a woman driver, route seats): only sent to an API that knows it
  const wave4 = Boolean(q && (q.seats || q.pool || q.route !== undefined || q.womenOnly));
  // the rider's choices made consistent with the quote (a seat is shared, sharing is cash)
  const choices = q
    ? orderChoices(
        {
          passengers: draft.passengers,
          shareable: draft.shareable,
          womenOnly: draft.womenOnly,
          fareMode: draft.fareMode,
          paymentMethod: draft.paymentMethod,
        },
        q,
        draft.rideClass,
      )
    : null;
  const shared = choices?.shareable ?? false;
  const seatPrice = choices?.fareMode === 'seat' ? routePrices(q, draft.rideClass)?.seat : null;
  // the trip's price: seats × people on a fixed route, else the class's fixed price
  const tripPrice = fare
    ? seatPrice
      ? seatTotal(seatPrice, choices!.passengers, fare.options)
      : fare.total
    : null;
  // a ride for later is booked with part of the price paid by card (the quote's rules)
  const deposit =
    later && fare
      ? rideDeposit(q?.deposit, draft.rideClass, tripPrice ?? fare.total, fare.total)
      : null;
  const maxParcelKg = q?.delivery?.maxWeightKg ?? 10;
  const parcel = delivery ? parcelErrors(draft, maxParcelKg) : null;
  // "Boshqa odam uchun" (taxi rides): the passenger's name and phone, never the rider's own
  const ownPhone = useMe().data?.phone ?? null;
  const passenger =
    !delivery && draft.forOther
      ? checkPassenger(draft.passengerName, draft.passengerPhone, ownPhone)
      : null;
  // rides for later are cash only (for now); shared rides too (a prepayment cannot be split)
  const cardAvailable = !later && !shared && (q?.paymentMethods.includes('card') ?? false);
  // the quote says which providers take this payment; /config and /tariffs for older APIs
  const providers = q?.cardProviders ?? config?.cardProviders ?? tariff.data?.cardProviders ?? null;
  // the rider's promo code (or invitation) and ride credit: rides now, not shared
  const discountOpts = { later: Boolean(later), shared, useCredit };
  const discount = classDiscount(q?.discounts, draft.rideClass, discountOpts);
  const discountTotal = discount?.total ?? 0;
  // fees owed from earlier cancelled cash rides: a cash ride collects them (a line apart)
  const owed = quoteOwedFee(q?.owedFee, draft.paymentMethod);
  const toPay =
    tripPrice !== null ? tripPrice - discountTotal + (owed?.collectedNow ? owed.amount : 0) : null;
  // a class switched off since (or never offered here) falls back to one the quote prices
  useEffect(() => {
    if (q && !q.fares[draft.rideClass]) {
      updateDraft({ rideClass: orderableClass(q, draft.rideClass) });
    }
  }, [q, draft.rideClass]);
  useEffect(() => {
    if (q && draft.paymentMethod === 'card' && !cardAvailable) {
      updateDraft({ paymentMethod: 'cash' });
    }
  }, [q, cardAvailable, draft.paymentMethod]);

  const submit = async (current: Quote) => {
    if (!pickup || !dropoff || busy) return;
    if (later && !schedulable(later, new Date())) {
      setError(t('order.schedule.tooSoon'));
      return;
    }
    if (passenger && !passenger.ok) {
      setTriedOrder(true);
      setError(passenger.nameError ?? passenger.phoneError ?? null);
      return;
    }
    if (parcel && !parcel.ok) {
      setTriedOrder(true);
      setError(
        parcel.weight.error ?? parcel.recipient.nameError ?? parcel.recipient.phoneError ?? null,
      );
      return;
    }
    const terms = orderChoices(
      {
        passengers: draft.passengers,
        shareable: draft.shareable,
        womenOnly: draft.womenOnly,
        fareMode: draft.fareMode,
        paymentMethod: draft.paymentMethod,
      },
      current,
      draft.rideClass,
    );
    const input = {
      quoteId: current.quoteId,
      class: draft.rideClass,
      paymentMethod: terms.paymentMethod,
      pickup: { address: pickup.address, landmark: draft.landmark.trim() || null },
      dropoff: { address: dropoff.address, landmark: null },
      comment: draft.comment.trim() || null,
      ...(passenger ? { passenger: { name: passenger.name, phone: passenger.phone! } } : {}),
      // the quote's stops in words (the points are the quote's)
      ...(current.stops?.length
        ? { stops: draft.stops.map((s) => ({ address: s.address, landmark: null })) }
        : {}),
      ...(parcel
        ? {
            parcel: {
              description: draft.parcelDescription.trim() || null,
              weightKg: parcel.weight.kg,
            },
            recipient: { name: parcel.recipient.name, phone: parcel.recipient.phone! },
          }
        : {}),
      ...(wave4 && !delivery
        ? {
            passengers: terms.passengers,
            shareable: terms.shareable,
            womenOnly: terms.womenOnly,
            fareMode: terms.fareMode,
          }
        : {}),
      // exactly the discount the quote showed for this class (none: older APIs ignore it)
      ...(discount && discount.total > 0 && !terms.shareable ? orderDiscount(discount) : {}),
    };
    await order.submit(input);
  };

  if (!pickup || !dropoff) return null;

  const optionPrices = tariff.data?.tariff?.options;
  const waiting = q?.waiting ?? tariff.data?.tariff?.waiting;
  // a fixed route seat price replaces the tariff's per-seat share of the car
  const seatText = fare && !routePrices(q, draft.rideClass)?.seat ? seatShareText(fare) : null;

  return (
    <KeyboardAvoider style={styles.root} keyboardVerticalOffset={90}>
      {delivery ? <Stack.Screen options={{ title: t('common.services.delivery') }} /> : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <RouteCard
          pickup={pickup}
          dropoff={dropoff}
          landmark={draft.landmark}
          distanceM={q?.distanceM}
          durationS={q?.durationS}
          stops={draft.stops}
          // a shared ride or a route seat has no stops (other riders' plans)
          canAddStop={!choices?.shareable && choices?.fareMode !== 'seat'}
        />
        {draft.stops.length && stopRulesText(q?.stopRules) ? (
          <T variant="small" color={colors.textMuted}>
            {stopRulesText(q?.stopRules)}
          </T>
        ) : null}

        {schedulingOn ? (
          <View style={styles.when}>
            <Segmented
              value={later ? 'later' : 'now'}
              onChange={(v) => {
                if (v === 'now') updateDraft({ scheduledFor: null });
                else setPickingTime(true);
              }}
              options={[
                { value: 'now', label: t('common.time.now'), icon: 'flash-outline' },
                { value: 'later', label: t('order.schedule.later'), icon: 'calendar-outline' },
              ]}
            />
            {later ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('order.schedule.pickupTimeA11y', {
                  time: formatDateTime(later),
                })}
                onPress={() => setPickingTime(true)}
                style={({ pressed }) => [styles.whenRow, pressed ? { opacity: 0.6 } : null]}
              >
                <Icon name="time-outline" size={20} color={colors.ink} />
                <View style={styles.flex}>
                  <T variant="bodyStrong">{formatDateTime(later)}</T>
                  <T variant="small" color={colors.textMuted}>
                    {t(
                      deposit
                        ? 'order.schedule.searchStartsDeposit'
                        : 'order.schedule.searchStartsCash',
                      { minutes: SCHEDULE_DISPATCH_BEFORE_MIN },
                    )}
                  </T>
                </View>
                <Icon name="create-outline" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {quote.isPending && !q ? (
          <View style={styles.gap}>
            <Skeleton height={86} />
            <Skeleton height={86} />
          </View>
        ) : null}

        {quote.isError && !q ? (
          <View style={styles.errorBox}>
            {quote.error instanceof ApiError && quote.error.status === 422 ? (
              <Banner
                tone="warning"
                title={t('order.quote.noServiceHere')}
                message={describeError(quote.error)}
              />
            ) : quote.error instanceof ApiError && quote.error.status === 400 ? (
              <Banner
                tone="warning"
                title={t('order.quote.checkAddress')}
                message={describeError(quote.error)}
              />
            ) : (
              <ErrorView error={quote.error} onRetry={() => void quote.refetch()} />
            )}
          </View>
        ) : null}

        {q ? (
          <>
            <View style={styles.fixed} accessible accessibilityRole="text">
              <Icon name="lock-closed" size={16} color={colors.ink} />
              <T variant="smallStrong" style={styles.flex}>
                {t('order.fare.fixedBanner')}
              </T>
            </View>

            {q.kind === 'intercity' ? (
              <Banner
                tone="info"
                icon="swap-horizontal"
                title={t('order.fare.intercityTitle', { distance: formatDistance(q.distanceM) })}
                message={seatText ?? undefined}
              />
            ) : null}

            <ClassCards
              quote={q}
              selected={draft.rideClass}
              onSelect={selectClass}
              discountOf={(c) => classDiscount(q.discounts, c, discountOpts)?.total ?? 0}
            />
            {fare && choices ? (
              <RouteModeChoice
                quote={q}
                rideClass={draft.rideClass}
                fareMode={choices.fareMode}
                carTotal={fare.total}
              />
            ) : null}
            <PromoRow
              discount={discount}
              creditBalance={q.discounts?.creditBalance ?? 0}
              useCredit={useCredit}
              onUseCredit={setUseCredit}
              unavailable={
                later ? t('order.promo.notForLater') : shared ? t('order.promo.notForShared') : null
              }
            />
            {fare && fare.night > 0 && !seatPrice ? (
              <T variant="small" color={colors.textMuted}>
                {t('order.fare.nightNote', { amount: formatMoney(fare.night) })}
              </T>
            ) : null}
            {owed ? (
              <Card style={styles.owed}>
                <View style={styles.owedRow}>
                  <T variant="bodyStrong" style={styles.flex}>
                    {owedFeeLabel()}
                  </T>
                  <T variant="bodyStrong">
                    {owed.collectedNow ? '+' : ''}
                    {formatMoney(owed.amount)}
                  </T>
                </View>
                <T variant="small" color={colors.textMuted}>
                  {owed.note}
                </T>
                {owed.collectedNow && fare ? (
                  <View style={styles.owedRow}>
                    <T variant="smallStrong" style={styles.flex}>
                      {t('order.fare.cashTotal')}
                    </T>
                    <T variant="smallStrong">{formatMoney(toPay ?? fare.total)}</T>
                  </View>
                ) : null}
              </Card>
            ) : null}
            {stale ? (
              <T variant="small" color={colors.textMuted}>
                {t('order.quote.updating')}
              </T>
            ) : null}
            {quote.isError ? (
              <Banner
                tone="warning"
                message={describeError(quote.error)}
                action={
                  <Button
                    title={t('order.quote.recalculate')}
                    size="sm"
                    variant="secondary"
                    onPress={() => void quote.refetch()}
                  />
                }
              />
            ) : null}
          </>
        ) : null}

        {delivery ? (
          <ParcelFields draft={draft} maxWeightKg={maxParcelKg} showErrors={triedOrder} />
        ) : (
          <>
            <T variant="h3" accessibilityRole="header" style={styles.section}>
              {t('order.options.title')}
            </T>
            <OrderOptions selected={draft.options} prices={optionPrices} onToggle={toggleOption}>
              {q && wave4 && choices ? (
                <>
                  <PassengersRow
                    quote={q}
                    passengers={choices.passengers}
                    rideClass={draft.rideClass}
                  />
                  <SharingRows quote={q} choices={choices} rideClass={draft.rideClass} />
                  <PassengerFields draft={draft} ownPhone={ownPhone} showErrors={triedOrder} />
                </>
              ) : null}
            </OrderOptions>
          </>
        )}
        {!delivery && draft.options.length ? (
          <T variant="small" color={colors.textMuted}>
            {t('order.options.fewerCars')}
          </T>
        ) : null}

        <TextField
          label={t('order.comment.label')}
          placeholder={t('order.comment.placeholder')}
          value={draft.comment}
          onChangeText={(comment) => updateDraft({ comment })}
          maxLength={500}
          multiline
        />

        <T variant="h3" accessibilityRole="header" style={styles.section}>
          {t('common.screens.payment')}
        </T>
        <Segmented
          value={draft.paymentMethod}
          onChange={(paymentMethod) => updateDraft({ paymentMethod })}
          options={[
            { value: 'cash', label: t('common.payment.cash'), icon: 'cash-outline' },
            {
              value: 'card',
              label: cardAvailable
                ? cardLabel(providers)
                : later || shared
                  ? t('common.payment.card')
                  : t('order.payment.cardSoon'),
              icon: 'card-outline',
              disabled: !cardAvailable,
            },
          ]}
        />
        {shared && !later ? (
          <T variant="small" color={colors.textMuted}>
            {t('order.payment.sharedCashOnly')}
          </T>
        ) : null}
        {deposit && tripPrice !== null ? (
          <Banner
            tone="info"
            icon="card-outline"
            title={t('order.payment.depositTitle')}
            message={rideDepositRules(
              deposit,
              tripPrice,
              later,
              q?.deposit?.freeCancelMinutes ?? RIDE_FREE_CANCEL_MINUTES,
            )}
          />
        ) : null}
        {draft.paymentMethod === 'card' && cardAvailable ? (
          <T variant="small" color={colors.textMuted}>
            {t('order.payment.cardNote', {
              amount: formatMoney((tripPrice ?? 0) - discountTotal),
            })}
          </T>
        ) : null}
        {later && !deposit ? (
          <T variant="small" color={colors.textMuted}>
            {t('order.payment.laterCashOnly')}
          </T>
        ) : null}
        {waiting ? (
          <T variant="small" color={colors.textMuted}>
            {t('order.fare.waitingNote', {
              minutes: waiting.free_minutes,
              perMinute: formatMoney(waiting.per_minute),
            })}
            {q
              ? ` ${t('order.fare.cancelAfterWaiting', { fee: formatMoney(q.cancellationFee) })}`
              : ''}
          </T>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space(3)) }]}>
        {error ? <Banner tone="danger" message={error} style={styles.footerError} /> : null}
        {q && fare ? (
          <View style={styles.summary} accessible accessibilityRole="summary">
            <View style={styles.flex}>
              <T variant="bodyStrong" numberOfLines={1}>
                {[
                  delivery ? t('order.parcel.title') : null,
                  rideClassLabel(draft.rideClass),
                  later ? formatDateTime(later) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </T>
              <T variant="small" color={colors.textMuted} numberOfLines={2}>
                {footerNote(t, {
                  later: Boolean(later),
                  deposit,
                  seats: seatPrice ? choices!.passengers : null,
                  sharedFloor:
                    shared && !seatPrice && q.pool && tripPrice !== null
                      ? sharedFloor(tripPrice, q.pool.discountPercent)
                      : null,
                  womenOnly: choices?.womenOnly ?? false,
                  availability: availabilityText(q.availability?.[draft.rideClass]),
                })}
              </T>
            </View>
            <T variant="price" style={stale ? styles.stalePrice : null}>
              {formatMoney(toPay ?? fare.total)}
            </T>
          </View>
        ) : null}
        <Button
          title={
            later
              ? t('order.submit.later')
              : draft.paymentMethod === 'card' && cardAvailable
                ? t('order.submit.orderAndPay')
                : t('order.submit.order')
          }
          size="lg"
          loading={busy}
          disabled={!q || stale || quote.isError}
          onPress={() => q && !stale && void submit(q)}
        />
      </View>

      <ScheduleSheet
        visible={pickingTime}
        value={later}
        onClose={() => setPickingTime(false)}
        onPick={(iso) => {
          setPickingTime(false);
          setError(null);
          updateDraft({ scheduledFor: iso, paymentMethod: 'cash' });
        }}
      />
    </KeyboardAvoider>
  );
}

/** The line under the class in the footer: what the price means, or the nearest car. */
function footerNote(
  t: Translate,
  n: {
    later: boolean;
    deposit: number | null;
    seats: number | null;
    sharedFloor: number | null;
    womenOnly: boolean;
    availability: string | null;
  },
): string {
  if (n.later) {
    return n.deposit
      ? t('order.submit.noteDeposit', { amount: formatMoney(n.deposit) })
      : t('order.submit.noteLaterCash');
  }
  if (n.seats) return t('order.submit.noteSeats', { count: n.seats });
  if (n.sharedFloor !== null) {
    return t('order.submit.noteShared', { amount: formatMoney(n.sharedFloor) });
  }
  if (n.womenOnly) return t('order.sharing.womanDriver');
  return n.availability ?? t('order.fare.fixed');
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  content: { padding: space(4), gap: space(3), paddingBottom: space(8) },
  gap: { gap: space(2.5) },
  errorBox: { minHeight: 200 },
  when: { gap: space(2) },
  whenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
    minHeight: 56,
  },
  route: { gap: 0, paddingVertical: space(2) },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2),
    minHeight: 52,
  },
  routeLine: {
    width: 2,
    height: 14,
    backgroundColor: colors.border,
    marginLeft: 5,
  },
  routeMeta: { marginTop: space(1) },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.ink },
  fixed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    backgroundColor: colors.brandSoft,
    borderRadius: radius.md,
    padding: space(3),
  },
  section: { marginTop: space(3) },
  owed: { gap: space(1.5), backgroundColor: colors.warningSoft },
  owedRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  landmark: { marginLeft: space(6), marginTop: space(1) },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  stalePrice: { opacity: 0.45 },
  footer: {
    paddingHorizontal: space(4),
    paddingTop: space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    gap: space(2),
  },
  footerError: { marginBottom: space(1) },
});
