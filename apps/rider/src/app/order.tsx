import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, describeError, isOffline } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys, useAppConfig, useQuote, useTariffAt } from '../api/queries';
import { useFeature } from '../api/support';
import type { Quote, RideClass } from '../api/types';
import {
  CLASS_LABELS,
  CLASS_NOTES,
  OPTION_HINTS,
  OPTION_LABELS,
  optionPriceLabel,
  OWED_FEE_LABEL,
  quoteOwedFee,
  RIDE_OPTIONS,
  seatShareText,
} from '../lib/fare';
import { formatDateTime, formatDistance, formatMinutes, formatMoney } from '../lib/format';
import { OrderAttempts, orderKey } from '../lib/order-attempt';
import { cardLabel } from '../lib/payment';
import { availabilityText } from '../lib/ride-state';
import { schedulable, SCHEDULE_DISPATCH_BEFORE_MIN } from '../lib/schedule';
import { askForPushAfterOrder } from '../notifications/push';
import { ScheduleSheet } from '../ride/ScheduleSheet';
import { resetAfterOrder, toggleOption, updateDraft, useDraft } from '../trip/draft';
import { refreshRecentPlaces } from '../trip/places-store';
import { markRideShown } from '../trip/shown-rides';
import { Banner, Button, Card, Icon, Segmented, T, TextField } from '../ui/primitives';
import { ErrorView, Skeleton } from '../ui/states';
import { colors, radius, space } from '../ui/theme';

const CLASSES: RideClass[] = ['economy', 'comfort'];

/**
 * Tariff choice: fixed prices of both classes for this route (quoted by the API, no
 * surge), options, the landmark and a comment for the driver, the payment method, then
 * the order — with one clientRequestId per attempt, so retries never order twice.
 */
export default function OrderScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const draft = useDraft();
  const { pickup, dropoff } = draft;
  const later = draft.scheduledFor;
  const quote = useQuote(pickup, dropoff, draft.options, later);
  const tariff = useTariffAt(pickup);
  const config = useAppConfig().data;
  const schedulingOn = useFeature('scheduledRides');
  const attempts = useRef(new OrderAttempts(() => Crypto.randomUUID())).current;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingTime, setPickingTime] = useState(false);
  /** Set once the order went through: the draft is reset while this screen leaves. */
  const leaving = useRef(false);

  // nothing to price (the app was restored here): back to the map
  useEffect(() => {
    if (!leaving.current && (!pickup || !dropoff)) router.replace('/home');
  }, [pickup, dropoff]);

  const q = quote.data;
  // the previous quote stays on screen while a new one loads (other options, another
  // time): it must not be ordered, the API would take its options and its time
  const stale = quote.isPlaceholderData;
  const fare = q?.fares[draft.rideClass];
  // rides for later are cash only (for now)
  const cardAvailable = !later && (q?.paymentMethods.includes('card') ?? false);
  // the quote says which providers take this payment; /config and /tariffs for older APIs
  const providers = q?.cardProviders ?? config?.cardProviders ?? tariff.data?.cardProviders ?? null;
  // fees owed from earlier cancelled cash rides: a cash ride collects them (a line apart)
  const owed = quoteOwedFee(q?.owedFee, draft.paymentMethod);
  const toPay = fare ? fare.total + (owed?.collectedNow ? owed.amount : 0) : null;
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
    const input = {
      quoteId: current.quoteId,
      class: draft.rideClass,
      paymentMethod: draft.paymentMethod,
      pickup: { address: pickup.address, landmark: draft.landmark.trim() || null },
      dropoff: { address: dropoff.address, landmark: null },
      comment: draft.comment.trim() || null,
    };
    const clientRequestId = attempts.idFor(orderKey(input));
    setBusy(true);
    setError(null);
    try {
      const { data: ride } = await endpoints.order({ ...input, clientRequestId });
      attempts.settle('created');
      refreshRecentPlaces();
      queryClient.setQueryData(keys.ride(ride.id), ride);
      // a ride for later does not block riding now: it is not the current ride
      if (ride.status === 'scheduled') {
        void queryClient.invalidateQueries({ queryKey: keys.scheduled });
      } else {
        queryClient.setQueryData(keys.currentRide, ride);
      }
      void queryClient.invalidateQueries({ queryKey: keys.history });
      leaving.current = true;
      markRideShown(ride.id);
      router.replace({ pathname: '/ride/[id]', params: { id: ride.id } });
      resetAfterOrder();
      void askForPushAfterOrder();
    } catch (e) {
      if (isOffline(e)) {
        // the ride may exist: the same clientRequestId on retry returns it, never a second one
        attempts.settle('unknown');
        setError('Aloqa yo‘q. Qayta bosing — buyurtma ikki marta tushmaydi.');
      } else if (e instanceof ApiError && e.status === 409) {
        attempts.settle('rejected');
        const rideId = (e.body as { rideId?: unknown } | null)?.rideId;
        if (typeof rideId === 'string') {
          leaving.current = true;
          markRideShown(rideId);
          router.replace({ pathname: '/ride/[id]', params: { id: rideId } });
          return;
        }
        setError(describeError(e));
      } else if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
        attempts.settle('rejected');
        setError('Narx yangilandi, qaytadan tasdiqlang.');
        void quote.refetch();
      } else if (e instanceof ApiError && e.status >= 500) {
        attempts.settle('unknown');
        setError(describeError(e));
      } else {
        attempts.settle('rejected');
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!pickup || !dropoff) return null;

  const optionPrices = tariff.data?.tariff?.options;
  const waiting = q?.waiting ?? tariff.data?.tariff?.waiting;
  const seatText = fare ? seatShareText(fare) : null;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card style={styles.route}>
          <RoutePoint
            color={colors.brand}
            label="QAYERDAN"
            text={pickup.address ?? 'Xaritadagi pin'}
            onPress={() => router.dismissTo('/home')}
          />
          <View style={styles.routeLine} />
          <RoutePoint
            color={colors.ink}
            label="QAYERGA"
            text={dropoff.address ?? 'Xaritadagi pin'}
            onPress={() => router.replace({ pathname: '/search', params: { field: 'dropoff' } })}
          />
          {q ? (
            <T variant="small" color={colors.textMuted} style={styles.routeMeta}>
              {formatDistance(q.distanceM)}
              {q.durationS ? ` · yo‘lda ~${formatMinutes(q.durationS / 60)}` : ''}
            </T>
          ) : null}
        </Card>

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
                    Qidiruv {SCHEDULE_DISPATCH_BEFORE_MIN} daqiqa oldin boshlanadi · naqd to‘lov
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
                  onPress={() => updateDraft({ rideClass: c })}
                />
              ))}
            </View>
            {fare && fare.night > 0 ? (
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

        <T variant="h3" accessibilityRole="header" style={styles.section}>
          Qo‘shimcha
        </T>
        <View style={styles.options}>
          {RIDE_OPTIONS.map((o) => {
            const on = draft.options.includes(o);
            return (
              <Pressable
                key={o}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${OPTION_LABELS[o]}. ${OPTION_HINTS[o]}. ${optionPriceLabel(optionPrices?.[o])}`}
                onPress={() => toggleOption(o)}
                style={styles.optionRow}
              >
                <View style={styles.flex}>
                  <T variant="bodyStrong">{OPTION_LABELS[o]}</T>
                  <T variant="small" color={colors.textMuted}>
                    {OPTION_HINTS[o]}
                  </T>
                </View>
                <T variant="smallStrong" color={colors.textMuted}>
                  {optionPriceLabel(optionPrices?.[o])}
                </T>
                <Switch
                  value={on}
                  onValueChange={() => toggleOption(o)}
                  trackColor={{ true: colors.brand, false: colors.border }}
                  thumbColor={on ? colors.ink : colors.bg}
                  importantForAccessibility="no"
                />
              </Pressable>
            );
          })}
        </View>
        {draft.options.length ? (
          <T variant="small" color={colors.textMuted}>
            Tanlangan qulayliklar mos mashinalarni kamaytiradi — qidiruv biroz uzoqroq bo‘lishi
            mumkin.
          </T>
        ) : null}

        <TextField
          label="Mo‘ljal (haydovchi uchun)"
          placeholder="Masalan: 5-maktab ro‘parasi, yashil darvoza"
          value={draft.landmark}
          onChangeText={(landmark) => updateDraft({ landmark })}
          maxLength={200}
          returnKeyType="next"
        />
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
              label: cardAvailable ? cardLabel(providers) : later ? 'Karta' : 'Karta (tez orada)',
              icon: 'card-outline',
              disabled: !cardAvailable,
            },
          ]}
        />
        {draft.paymentMethod === 'card' && cardAvailable ? (
          <T variant="small" color={colors.textMuted}>
            Buyurtmadan keyin {formatMoney(fare?.total ?? 0)} ni 10 daqiqa ichida to‘laysiz, shundan
            so‘ng haydovchi qidiriladi. Bekor qilsangiz, pul to‘liq qaytariladi.
          </T>
        ) : null}
        {later ? (
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
        <Button
          title={
            later
              ? 'Oldindan buyurtma berish'
              : draft.paymentMethod === 'card' && cardAvailable
                ? 'Buyurtma va to‘lov'
                : 'Buyurtma berish'
          }
          size="lg"
          trailing={toPay !== null ? formatMoney(toPay) : undefined}
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
    </KeyboardAvoidingView>
  );
}

function RoutePoint({
  color,
  label,
  text,
  onPress,
}: {
  color: string;
  label: string;
  text: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label === 'QAYERDAN' ? 'Qayerdan' : 'Qayerga'}: ${text}. O‘zgartirish`}
      onPress={onPress}
      style={({ pressed }) => [styles.routePoint, pressed ? { opacity: 0.6 } : null]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.flex}>
        <T variant="caption" color={colors.textMuted}>
          {label}
        </T>
        <T variant="bodyStrong" numberOfLines={2}>
          {text}
        </T>
      </View>
      <Icon name="create-outline" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function ClassCard({
  rideClass,
  quote,
  selected,
  onPress,
}: {
  rideClass: RideClass;
  quote: Quote;
  selected: boolean;
  onPress: () => void;
}) {
  const fare = quote.fares[rideClass];
  const availability = availabilityText(quote.availability?.[rideClass]);
  const noCar = quote.availability?.[rideClass]?.etaS === null;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${CLASS_LABELS[rideClass]}, ${formatMoney(fare.total)}, narx o‘zgarmaydi${availability ? `. ${availability}` : ''}`}
      onPress={onPress}
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
        {availability ? (
          <T
            variant="smallStrong"
            color={noCar ? colors.warning : colors.success}
            numberOfLines={1}
          >
            {availability}
          </T>
        ) : null}
      </View>
      <View style={styles.priceCol}>
        <T variant="price">{formatMoney(fare.total)}</T>
        {fare.seat ? (
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
  options: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
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
