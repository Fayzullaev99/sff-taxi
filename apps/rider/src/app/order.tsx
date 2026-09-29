import { router, Stack } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, describeError } from '../api/client';
import { useAppConfig, useQuote, useTariffAt } from '../api/queries';
import { useFeature } from '../api/support';
import type { Quote, RideClass } from '../api/types';
import {
  CLASS_LABELS,
  CLASS_NOTES,
  OWED_FEE_LABEL,
  quoteOwedFee,
  seatShareText,
} from '../lib/fare';
import { formatDateTime, formatDistance, formatMoney } from '../lib/format';
import { cardLabel } from '../lib/payment';
import { availabilityShort, availabilityText } from '../lib/ride-state';
import { schedulable, SCHEDULE_DISPATCH_BEFORE_MIN } from '../lib/schedule';
import { OrderOptions } from '../order/OrderOptions';
import { PassengersRow, RouteModeChoice, SharingRows } from '../order/RideChoices';
import { orderChoices, routePrices, seatTotal, sharedFloor } from '../lib/sharing';
import { RIDE_FREE_CANCEL_MINUTES, rideDeposit, rideDepositRules } from '../lib/deposit';
import { ParcelFields, parcelErrors } from '../order/ParcelFields';
import { useOrderSubmit } from '../order/useOrderSubmit';
import { RouteCard } from '../order/RouteCard';
import { ScheduleSheet } from '../ride/ScheduleSheet';
import { toggleOption, updateDraft, useDraft } from '../trip/draft';
import { Banner, Button, Card, Icon, Segmented, T, TextField } from '../ui/primitives';
import { ErrorView, Skeleton } from '../ui/states';
import { colors, radius, space } from '../ui/theme';
import { KeyboardAvoider } from '../ui/KeyboardAvoider';

const CLASSES: RideClass[] = ['economy', 'comfort'];

/** Stable, so the memoised class cards re-render only when their quote or choice changes. */
const selectClass = (rideClass: RideClass) => updateDraft({ rideClass });

/**
 * Tariff choice: fixed prices of both classes for this route (quoted by the API, no
 * surge), options, the landmark and a comment for the driver, the payment method, then
 * the order — with one clientRequestId per attempt, so retries never order twice.
 */
export default function OrderScreen() {
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
  );
  const [triedOrder, setTriedOrder] = useState(false);
  const tariff = useTariffAt(pickup);
  const config = useAppConfig().data;
  const schedulingOn = useFeature('scheduledRides');
  const order = useOrderSubmit(() => void quote.refetch());
  const { busy, error, setError, leaving } = order;
  const [pickingTime, setPickingTime] = useState(false);

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
  // rides for later are cash only (for now); shared rides too (a prepayment cannot be split)
  const cardAvailable = !later && !shared && (q?.paymentMethods.includes('card') ?? false);
  // the quote says which providers take this payment; /config and /tariffs for older APIs
  const providers = q?.cardProviders ?? config?.cardProviders ?? tariff.data?.cardProviders ?? null;
  // fees owed from earlier cancelled cash rides: a cash ride collects them (a line apart)
  const owed = quoteOwedFee(q?.owedFee, draft.paymentMethod);
  const toPay = tripPrice !== null ? tripPrice + (owed?.collectedNow ? owed.amount : 0) : null;
  useEffect(() => {
    if (q && draft.paymentMethod === 'card' && !cardAvailable) {
      updateDraft({ paymentMethod: 'cash' });
    }
  }, [q, cardAvailable, draft.paymentMethod]);

  const submit = async (current: Quote) => {
    if (!pickup || !dropoff || busy) return;
    if (later && !schedulable(later, new Date())) {
      setError('Tanlangan vaqt juda yaqin qoldi. Boshqa vaqtni tanlang.');
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
      {delivery ? <Stack.Screen options={{ title: 'Yetkazib berish' }} /> : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <RouteCard
          pickup={pickup}
          dropoff={dropoff}
          landmark={draft.landmark}
          distanceM={q?.distanceM}
          durationS={q?.durationS}
        />

        {schedulingOn ? (
          <View style={styles.when}>
            <Segmented
              value={later ? 'later' : 'now'}
              onChange={(v) => {
                if (v === 'now') updateDraft({ scheduledFor: null });
                else setPickingTime(true);
              }}
              options={[
                { value: 'now', label: 'Hozir', icon: 'flash-outline' },
                { value: 'later', label: 'Keyinroq', icon: 'calendar-outline' },
              ]}
            />
            {later ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Olib ketish vaqti: ${formatDateTime(later)}. O‘zgartirish`}
                onPress={() => setPickingTime(true)}
                style={({ pressed }) => [styles.whenRow, pressed ? { opacity: 0.6 } : null]}
              >
                <Icon name="time-outline" size={20} color={colors.ink} />
                <View style={styles.flex}>
                  <T variant="bodyStrong">{formatDateTime(later)}</T>
                  <T variant="small" color={colors.textMuted}>
                    Qidiruv {SCHEDULE_DISPATCH_BEFORE_MIN} daqiqa oldin boshlanadi ·{' '}
                    {deposit ? 'oldindan to‘lov kartadan, qolgani naqd' : 'naqd to‘lov'}
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
                title="Bu hududda hozircha ishlamaymiz"
                message={describeError(quote.error)}
              />
            ) : quote.error instanceof ApiError && quote.error.status === 400 ? (
              <Banner
                tone="warning"
                title="Manzilni tekshiring"
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
                Narx o‘zgarmaydi — tirbandlik va talabdan qat’i nazar
              </T>
            </View>

            {q.kind === 'intercity' ? (
              <Banner
                tone="info"
                icon="swap-horizontal"
                title={`Shaharlararo safar · ${formatDistance(q.distanceM)}`}
                message={seatText ?? undefined}
              />
            ) : null}

            <View style={styles.gap} accessibilityRole="radiogroup">
              {CLASSES.map((c) => (
                <ClassCard
                  key={c}
                  rideClass={c}
                  quote={q}
                  selected={draft.rideClass === c}
                  onSelect={selectClass}
                />
              ))}
            </View>
            {fare && choices ? (
              <RouteModeChoice
                quote={q}
                rideClass={draft.rideClass}
                fareMode={choices.fareMode}
                carTotal={fare.total}
              />
            ) : null}
            {fare && fare.night > 0 && !seatPrice ? (
              <T variant="small" color={colors.textMuted}>
                Tungi vaqt: narxga {formatMoney(fare.night)} qo‘shilgan (oldindan ma’lum,
                o‘zgarmaydi).
              </T>
            ) : null}
            {owed ? (
              <Card style={styles.owed}>
                <View style={styles.owedRow}>
                  <T variant="bodyStrong" style={styles.flex}>
                    {OWED_FEE_LABEL}
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
                      Jami naqd
                    </T>
                    <T variant="smallStrong">{formatMoney(toPay ?? fare.total)}</T>
                  </View>
                ) : null}
              </Card>
            ) : null}
            {stale ? (
              <T variant="small" color={colors.textMuted}>
                Narx yangilanmoqda…
              </T>
            ) : null}
            {quote.isError ? (
              <Banner
                tone="warning"
                message={describeError(quote.error)}
                action={
                  <Button
                    title="Qayta hisoblash"
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
              Qo‘shimcha
            </T>
            <OrderOptions selected={draft.options} prices={optionPrices} onToggle={toggleOption}>
              {q && wave4 && choices ? (
                <>
                  <PassengersRow quote={q} passengers={choices.passengers} />
                  <SharingRows quote={q} choices={choices} />
                </>
              ) : null}
            </OrderOptions>
          </>
        )}
        {!delivery && draft.options.length ? (
          <T variant="small" color={colors.textMuted}>
            Tanlangan qulayliklar mos mashinalarni kamaytiradi — qidiruv biroz uzoqroq bo‘lishi
            mumkin.
          </T>
        ) : null}

        <TextField
          label="Izoh"
          placeholder="Masalan: bolali aravacha bor, podyezd oldida kutaman"
          value={draft.comment}
          onChangeText={(comment) => updateDraft({ comment })}
          maxLength={500}
          multiline
        />

        <T variant="h3" accessibilityRole="header" style={styles.section}>
          To‘lov
        </T>
        <Segmented
          value={draft.paymentMethod}
          onChange={(paymentMethod) => updateDraft({ paymentMethod })}
          options={[
            { value: 'cash', label: 'Naqd', icon: 'cash-outline' },
            {
              value: 'card',
              label: cardAvailable
                ? cardLabel(providers)
                : later || shared
                  ? 'Karta'
                  : 'Karta (tez orada)',
              icon: 'card-outline',
              disabled: !cardAvailable,
            },
          ]}
        />
        {shared && !later ? (
          <T variant="small" color={colors.textMuted}>
            Hamroh bilan safar hozircha faqat naqd to‘lov bilan.
          </T>
        ) : null}
        {deposit && tripPrice !== null ? (
          <Banner
            tone="info"
            icon="card-outline"
            title="Oldindan to‘lov (depozit)"
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
            Buyurtmadan keyin {formatMoney(tripPrice ?? 0)}ni 10 daqiqa ichida to‘laysiz, shundan
            so‘ng haydovchi qidiriladi. Bekor qilsangiz, pul to‘liq qaytariladi.
          </T>
        ) : null}
        {later && !deposit ? (
          <T variant="small" color={colors.textMuted}>
            Oldindan buyurtma hozircha faqat naqd to‘lov bilan.
          </T>
        ) : null}
        {waiting ? (
          <T variant="small" color={colors.textMuted}>
            Haydovchi yetib kelgach {waiting.free_minutes} daqiqa kutish bepul, keyin har daqiqa{' '}
            {formatMoney(waiting.per_minute)}.
            {q ? ` Kutish tugagach bekor qilish ${formatMoney(q.cancellationFee)}.` : ''}
          </T>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space(3)) }]}>
        {error ? <Banner tone="danger" message={error} style={styles.footerError} /> : null}
        {q && fare ? (
          <View style={styles.summary} accessible accessibilityRole="summary">
            <View style={styles.flex}>
              <T variant="bodyStrong" numberOfLines={1}>
                {delivery ? 'Posilka · ' : ''}
                {CLASS_LABELS[draft.rideClass]}
                {later ? ` · ${formatDateTime(later)}` : ''}
              </T>
              <T variant="small" color={colors.textMuted} numberOfLines={2}>
                {footerNote({
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
              ? 'Oldindan buyurtma berish'
              : draft.paymentMethod === 'card' && cardAvailable
                ? 'Buyurtma va to‘lov'
                : 'Buyurtma berish'
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
function footerNote(n: {
  later: boolean;
  deposit: number | null;
  seats: number | null;
  sharedFloor: number | null;
  womenOnly: boolean;
  availability: string | null;
}): string {
  if (n.later) {
    return n.deposit
      ? `Oldindan to‘lov ${formatMoney(n.deposit)} kartadan, qolgani naqd`
      : 'Oldindan buyurtma · naqd';
  }
  if (n.seats) return `O‘rindiq × ${n.seats} · mashina hamroh bilan`;
  if (n.sharedFloor !== null) {
    return `Hamroh bilan: ${formatMoney(n.sharedFloor)}gacha arzonlashishi mumkin`;
  }
  if (n.womenOnly) return 'Ayol haydovchi';
  return n.availability ?? 'Narx o‘zgarmaydi';
}

const ClassCard = memo(function ClassCard({
  rideClass,
  quote,
  selected,
  onSelect,
}: {
  rideClass: RideClass;
  quote: Quote;
  selected: boolean;
  onSelect: (rideClass: RideClass) => void;
}) {
  const fare = quote.fares[rideClass];
  const availability = availabilityText(quote.availability?.[rideClass]);
  const short = availabilityShort(quote.availability?.[rideClass]);
  const noCar = quote.availability?.[rideClass]?.etaS === null;
  // a fixed route seat price (Yangiyer → Guliston 10 000) is the seat price to show
  const routeSeat = routePrices(quote, rideClass)?.seat ?? null;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${CLASS_LABELS[rideClass]}, ${formatMoney(fare.total)}, narx o‘zgarmaydi${availability ? `. ${availability}` : ''}`}
      onPress={() => onSelect(rideClass)}
      style={[styles.classCard, selected ? styles.classCardOn : null]}
    >
      <View style={[styles.classIcon, selected ? { backgroundColor: colors.brand } : null]}>
        <Icon name={rideClass === 'comfort' ? 'car-sport' : 'car'} size={24} color={colors.ink} />
      </View>
      <View style={styles.flex}>
        <T variant="h3">{CLASS_LABELS[rideClass]}</T>
        <T variant="small" color={colors.textMuted} numberOfLines={2}>
          {CLASS_NOTES[rideClass]}
        </T>
        {short ? (
          <T
            variant="smallStrong"
            color={noCar ? colors.warning : colors.success}
            numberOfLines={1}
          >
            {short}
          </T>
        ) : null}
      </View>
      <View style={styles.priceCol}>
        <T variant="price">{formatMoney(fare.total)}</T>
        {routeSeat ? (
          <T variant="caption" color={colors.textMuted}>
            o‘rindiq {formatMoney(routeSeat)}
          </T>
        ) : fare.seat ? (
          <T variant="caption" color={colors.textMuted}>
            o‘rindiq {formatMoney(fare.seat.rear)}
          </T>
        ) : (
          <T variant="caption" color={colors.textMuted}>
            aniq narx
          </T>
        )}
      </View>
    </Pressable>
  );
});

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
  classCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(3.5),
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    minHeight: 76,
  },
  classCardOn: { borderColor: colors.ink, backgroundColor: colors.brandSoft },
  classIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceCol: { alignItems: 'flex-end', maxWidth: '45%' },
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
