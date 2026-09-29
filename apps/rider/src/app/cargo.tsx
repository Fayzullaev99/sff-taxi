import { router, Stack } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, describeError } from '../api/client';
import { useAppConfig, useCargoQuote } from '../api/queries';
import { useFeature } from '../api/support';
import type { CargoClass, CargoQuote } from '../api/types';
import { formatDateTime, formatMoney } from '../lib/format';
import { cardLabel } from '../lib/payment';
import { availabilityText } from '../lib/ride-state';
import { schedulable, SCHEDULE_DISPATCH_BEFORE_MIN } from '../lib/schedule';
import {
  CARGO_CLASS_LABELS,
  CARGO_CLASS_NOTES,
  CARGO_CLASSES,
  cargoClassFor,
  cargoFits,
  cargoLimitsText,
  loadersText,
  parseWeight,
} from '../lib/services';
import { PreferenceRow } from '../order/OrderOptions';
import { RouteCard } from '../order/RouteCard';
import { useOrderSubmit } from '../order/useOrderSubmit';
import { ScheduleSheet } from '../ride/ScheduleSheet';
import { updateDraft, useDraft } from '../trip/draft';
import { KeyboardAvoider } from '../ui/KeyboardAvoider';
import { Banner, Button, Icon, Segmented, Stepper, T, TextField } from '../ui/primitives';
import { ErrorView, Skeleton } from '../ui/states';
import { colors, radius, space } from '../ui/theme';

/** Heaviest load anyone may type (the API's own limit); each class says its payload. */
const MAX_TYPED_KG = 20_000;

/**
 * "Yuk tashish": a cargo car (small: Damas/Labo, medium: Gazel/Porter) at a fixed price
 * with its included km and loading minutes, loaders (0–2) priced apart, the customer
 * riding in the cab or not, what the load is and its weight (checked against the class's
 * payload). Ordered like a taxi ride (one clientRequestId per attempt).
 */
export default function CargoScreen() {
  const insets = useSafeAreaInsets();
  const draft = useDraft();
  const { pickup, dropoff } = draft;
  const later = draft.scheduledFor;
  const quote = useCargoQuote(
    pickup,
    dropoff,
    { loaders: draft.loaders, riderRides: draft.riderRides },
    later,
  );
  const config = useAppConfig().data;
  const schedulingOn = useFeature('scheduledRides');
  const order = useOrderSubmit(() => void quote.refetch());
  const [pickingTime, setPickingTime] = useState(false);

  useEffect(() => {
    if (!order.leaving.current && (!pickup || !dropoff)) router.replace('/home');
  }, [pickup, dropoff, order.leaving]);

  const q = quote.data;
  const stale = quote.isPlaceholderData;
  const classes = q?.cargo.classes;
  const maxPayload = Math.min(
    MAX_TYPED_KG,
    Math.max(...CARGO_CLASSES.map((c) => classes?.[c]?.maxPayloadKg ?? 0), 0) || MAX_TYPED_KG,
  );
  const weight = parseWeight(draft.loadWeight, maxPayload);
  const rideClass = draft.cargoClass;
  const fits = cargoFits(classes?.[rideClass], weight.kg);
  const fare = q?.fares[rideClass];
  const maxLoaders = q?.cargo.maxLoaders ?? 2;
  const cardAvailable = !later && (q?.paymentMethods.includes('card') ?? false);
  const providers = q?.cardProviders ?? config?.cardProviders ?? null;

  // a heavier load moves to the class that takes it
  const kg = weight.kg;
  useEffect(() => {
    if (!classes || kg === null) return;
    const best = cargoClassFor(classes, kg, rideClass);
    if (best !== rideClass) updateDraft({ cargoClass: best });
  }, [classes, kg, rideClass]);

  useEffect(() => {
    if (q && draft.paymentMethod === 'card' && !cardAvailable) {
      updateDraft({ paymentMethod: 'cash' });
    }
  }, [q, cardAvailable, draft.paymentMethod]);

  const submit = async (current: CargoQuote) => {
    if (!pickup || !dropoff || order.busy) return;
    if (later && !schedulable(later, new Date())) {
      order.setError('Tanlangan vaqt juda yaqin qoldi. Boshqa vaqtni tanlang.');
      return;
    }
    if (weight.error || !fits) {
      order.setError(
        weight.error ??
          `Yuk ${CARGO_CLASS_LABELS[rideClass].toLowerCase()} mashinaga sig‘maydi: kattaroq sinfni tanlang.`,
      );
      return;
    }
    await order.submit({
      quoteId: current.quoteId,
      class: rideClass,
      paymentMethod: cardAvailable ? draft.paymentMethod : 'cash',
      pickup: { address: pickup.address, landmark: draft.landmark.trim() || null },
      dropoff: { address: dropoff.address, landmark: null },
      comment: draft.comment.trim() || null,
      cargo: { description: draft.loadDescription.trim() || null, weightKg: weight.kg },
    });
  };

  if (!pickup || !dropoff) return null;

  return (
    <KeyboardAvoider style={styles.root} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: 'Yuk tashish' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <RouteCard
          pickup={pickup}
          dropoff={dropoff}
          landmark={draft.landmark}
          distanceM={q?.distanceM}
          durationS={q?.durationS}
          landmarkPlaceholder="Mo‘ljal: ombor darvozasi"
        />

        {schedulingOn ? (
          <View style={styles.gap}>
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
              <T variant="small" color={colors.textMuted}>
                {formatDateTime(later)} · qidiruv {SCHEDULE_DISPATCH_BEFORE_MIN} daqiqa oldin
                boshlanadi
              </T>
            ) : null}
          </View>
        ) : null}

        {quote.isPending && !q ? (
          <View style={styles.gap}>
            <Skeleton height={96} />
            <Skeleton height={96} />
          </View>
        ) : null}
        {quote.isError && !q ? (
          quote.error instanceof ApiError && quote.error.status < 500 ? (
            <Banner tone="warning" title="Yuk tashish" message={describeError(quote.error)} />
          ) : (
            <View style={styles.errorBox}>
              <ErrorView error={quote.error} onRetry={() => void quote.refetch()} />
            </View>
          )
        ) : null}

        {q ? (
          <View style={styles.gap} accessibilityRole="radiogroup">
            {CARGO_CLASSES.map((c) => (
              <CargoClassCard
                key={c}
                cargoClass={c}
                quote={q}
                weightKg={weight.kg}
                selected={rideClass === c}
              />
            ))}
          </View>
        ) : null}
        {stale ? (
          <T variant="small" color={colors.textMuted}>
            Narx yangilanmoqda…
          </T>
        ) : null}

        <T variant="h3" accessibilityRole="header" style={styles.section}>
          Yuk
        </T>
        <TextField
          label="Nima tashiladi"
          placeholder="Masalan: divan va 10 ta quti, sement 20 qop"
          value={draft.loadDescription}
          onChangeText={(loadDescription) => updateDraft({ loadDescription })}
          maxLength={300}
        />
        <TextField
          label="Taxminiy og‘irligi, kg (ixtiyoriy)"
          placeholder="Masalan: 300"
          keyboardType="number-pad"
          value={draft.loadWeight}
          onChangeText={(loadWeight) => updateDraft({ loadWeight })}
          maxLength={5}
          error={
            weight.error ??
            (!fits && classes
              ? `${CARGO_CLASS_LABELS[rideClass]} mashina ${classes[rideClass].maxPayloadKg} kg gacha oladi`
              : null)
          }
        />

        <View style={styles.group}>
          <View style={styles.loaders}>
            <View style={styles.flex}>
              <T variant="bodyStrong">Yukchilar</T>
              <T variant="small" color={colors.textMuted}>
                {loadersText(draft.loaders, q?.cargo.loaderPrice ?? 30_000)}
              </T>
            </View>
            <Stepper
              value={draft.loaders}
              min={0}
              max={maxLoaders}
              trashAtZero={false}
              onChange={(loaders) =>
                updateDraft({ loaders: Math.max(0, Math.min(maxLoaders, loaders)) })
              }
            />
          </View>
          <PreferenceRow
            label="O‘zim ham boraman"
            hint="Kabinada bitta joy: yuk bilan birga borasiz"
            value={draft.riderRides}
            onChange={(riderRides) => updateDraft({ riderRides })}
          />
        </View>

        <TextField
          label="Izoh"
          placeholder="Masalan: 3-qavat, lift yo‘q"
          value={draft.comment}
          onChangeText={(comment) => updateDraft({ comment })}
          maxLength={500}
          multiline
        />

        <T variant="h3" accessibilityRole="header" style={styles.section}>
          To‘lov
        </T>
        <Segmented
          value={cardAvailable ? draft.paymentMethod : 'cash'}
          onChange={(paymentMethod) => updateDraft({ paymentMethod })}
          options={[
            { value: 'cash', label: 'Naqd', icon: 'cash-outline' },
            {
              value: 'card',
              label: cardAvailable ? cardLabel(providers) : 'Karta',
              icon: 'card-outline',
              disabled: !cardAvailable,
            },
          ]}
        />
        {fare ? (
          <T variant="small" color={colors.textMuted}>
            Narxga {fare.cargo.includedMinutes} daqiqa yuklash kiradi, keyin har daqiqa{' '}
            {formatMoney(fare.cargo.perMinute)}. Narx buyurtmada belgilanadi va o‘zgarmaydi.
          </T>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space(3)) }]}>
        {order.error ? <Banner tone="danger" message={order.error} /> : null}
        {q && fare ? (
          <View style={styles.summary} accessible accessibilityRole="summary">
            <View style={styles.flex}>
              <T variant="bodyStrong" numberOfLines={1}>
                {CARGO_CLASS_LABELS[rideClass]} yuk mashinasi
                {later ? ` · ${formatDateTime(later)}` : ''}
              </T>
              <T variant="small" color={colors.textMuted} numberOfLines={1}>
                {later
                  ? 'Oldindan buyurtma'
                  : (availabilityText(q.availability?.[rideClass]) ?? 'Narx o‘zgarmaydi')}
              </T>
            </View>
            <T variant="price" style={stale ? styles.stalePrice : null}>
              {formatMoney(fare.total)}
            </T>
          </View>
        ) : null}
        <Button
          title={later ? 'Oldindan buyurtma berish' : 'Yuk mashinasini chaqirish'}
          size="lg"
          loading={order.busy}
          disabled={!q || stale || quote.isError || !fits || Boolean(weight.error)}
          onPress={() => q && !stale && void submit(q)}
        />
      </View>

      <ScheduleSheet
        visible={pickingTime}
        value={later}
        onClose={() => setPickingTime(false)}
        onPick={(iso) => {
          setPickingTime(false);
          order.setError(null);
          updateDraft({ scheduledFor: iso, paymentMethod: 'cash' });
        }}
      />
    </KeyboardAvoider>
  );
}

const selectCargoClass = (cargoClass: CargoClass) => updateDraft({ cargoClass });

/** A cargo class: the price, what it takes (payload, included km and minutes), its ETA. */
const CargoClassCard = memo(function CargoClassCard({
  cargoClass,
  quote,
  weightKg,
  selected,
}: {
  cargoClass: CargoClass;
  quote: CargoQuote;
  weightKg: number | null;
  selected: boolean;
}) {
  const fare = quote.fares[cargoClass];
  const rules = quote.cargo.classes[cargoClass];
  const fits = cargoFits(rules, weightKg);
  const availability = availabilityText(quote.availability?.[cargoClass]);
  const noCar = quote.availability?.[cargoClass]?.etaS === null;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !fits }}
      accessibilityLabel={`${CARGO_CLASS_LABELS[cargoClass]} yuk mashinasi, ${formatMoney(fare.total)}${fits ? '' : ', yuk sig‘maydi'}`}
      disabled={!fits}
      onPress={() => selectCargoClass(cargoClass)}
      style={[styles.card, selected ? styles.cardOn : null, !fits ? styles.cardOff : null]}
    >
      <View style={[styles.icon, selected ? styles.iconOn : null]}>
        <Icon name={cargoClass === 'cargo_m' ? 'bus' : 'car'} size={24} color={colors.ink} />
      </View>
      <View style={styles.flex}>
        <T variant="h3">{CARGO_CLASS_LABELS[cargoClass]}</T>
        <T variant="small" color={colors.textMuted} numberOfLines={1}>
          {CARGO_CLASS_NOTES[cargoClass]}
        </T>
        {rules ? (
          <T variant="small" color={colors.textMuted} numberOfLines={3}>
            {cargoLimitsText(rules)}
          </T>
        ) : null}
        {!fits ? (
          <T variant="smallStrong" color={colors.warning}>
            Yuk sig‘maydi
          </T>
        ) : availability ? (
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
        {fare.cargo.loadersTotal > 0 ? (
          <T variant="caption" color={colors.textMuted}>
            yukchilar bilan
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
  section: { marginTop: space(3) },
  group: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  loaders: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  card: {
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
  cardOn: { borderColor: colors.ink, backgroundColor: colors.brandSoft },
  cardOff: { opacity: 0.5 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOn: { backgroundColor: colors.brand },
  priceCol: { alignItems: 'flex-end', maxWidth: '40%' },
  footer: {
    paddingHorizontal: space(4),
    paddingTop: space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    gap: space(2),
  },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  stalePrice: { opacity: 0.45 },
});
