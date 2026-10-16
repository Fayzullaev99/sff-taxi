import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { driver } from '../../api/driver';
import type { DriverRide } from '../../api/types';
import { keys, useDriverConfig, useRide } from '../../data/queries';
import { type TKey, useT } from '../../i18n';
import { errorMessage, isApiError } from '../../lib/api-client';
import { COMMISSION_NOTES, digits, som } from '../../lib/format';
import { withRetry } from '../../lib/ride-actions';
import { depositLine, SERVICE_LABELS, serviceOf } from '../../lib/service';
import { amountToCollect, cashBreakdown, cashPartsText, owedFeeNote } from '../../lib/ride-flow';
import {
  Banner,
  Button,
  Card,
  Choice,
  ErrorState,
  Loading,
  Muted,
  Row,
  Title,
} from '../../ui/components';
import { TipLine } from '../../ride/tip-line';
import { haptics } from '../../ui/haptics';
import { Screen } from '../../ui/screen';
import { colors, space } from '../../ui/theme';

/**
 * The rating tags. The API stores the tag's text: the Uzbek one is sent whatever the app's
 * language (the office and other drivers read one set), the label is shown translated.
 */
const GOOD_TAGS: TKey[] = [
  'ride.done.tagOnTime',
  'ride.done.tagPolite',
  'ride.done.tagClean',
  'ride.done.tagClearAddress',
];
const BAD_TAGS: TKey[] = [
  'ride.done.tagLate',
  'ride.done.tagRude',
  'ride.done.tagDirty',
  'ride.done.tagWrongAddress',
];

/** After "Yakunlash": the cash to take, shown huge; what the ride earned; rate the rider. */
export default function RideDone() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useT();
  const taxPercent = useDriverConfig().billing.taxPercent;
  const ride = useRide(String(id));
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const qc = useQueryClient();
  // a shared car may still carry riders: then on to the next stop
  const next = () =>
    router.replace(qc.getQueryData<DriverRide | null>(keys.current) ? '/ride' : '/home');

  const rate = useMutation({
    mutationFn: () =>
      withRetry(() => driver.rateRider(String(id), stars, tags, null), {
        attempts: 3,
        baseMs: 1_000,
        maxMs: 4_000,
      }).catch((error: unknown) => {
        // already rated (a lost answer): nothing more to do
        if (isApiError(error, 409)) return null;
        throw error;
      }),
    onSuccess: () => {
      haptics.success();
      next();
    },
    onError: () => haptics.error(),
  });

  if (!ride.data) {
    if (!ride.isError) return <Loading />;
    return (
      <Screen title={t('ride.done.title')}>
        <ErrorState message={errorMessage(ride.error)} onRetry={() => void ride.refetch()} />
        <Button
          title={t('common.screens.home')}
          variant="secondary"
          onPress={() => router.replace('/home')}
        />
      </Screen>
    );
  }
  const r = ride.data;
  const cash = r.paymentMethod === 'cash';
  const total = amountToCollect(r.fare);
  // the API's collectCash: the fare (a card ride was prepaid), paid waiting and fees the
  // rider owed from earlier cancelled rides
  const money = cashBreakdown(r);
  const cashNow = money.total;
  const parts = cashPartsText(money);
  const owedNote = owedFeeNote(money.owedFee);
  // the rider's promo / bonus: the platform pays it (cash rides: onto the balance)
  const bonus = r.discount?.compensation ?? 0;
  const service = serviceOf(r);
  const deposit = depositLine(r.fare.deposit, cashNow);
  const e = r.earnings;
  const tagKeys = stars >= 4 ? GOOD_TAGS : stars > 0 ? BAD_TAGS : [];
  const options = tagKeys.map((key) => ({ value: t(key, undefined, 'uz'), label: t(key) }));

  return (
    <Screen
      footer={
        <>
          {rate.error ? (
            <Banner tone="danger" icon="alert-circle" text={errorMessage(rate.error)} />
          ) : null}
          <Button
            title={stars ? t('ride.done.rateAndNext') : t('common.actions.next')}
            big
            icon="arrow-forward"
            loading={rate.isPending}
            onPress={() => (stars ? rate.mutate() : next())}
          />
          {rate.error ? (
            <Button
              title={t('ride.done.nextWithoutRating')}
              variant="secondary"
              onPress={() => next()}
            />
          ) : null}
        </>
      }
    >
      <View style={styles.collectBox}>
        <Ionicons name={cash ? 'cash' : 'card'} size={40} color={colors.onBrand} />
        {service !== 'taxi' ? (
          <Text style={styles.collectNote}>{SERVICE_LABELS[service]}</Text>
        ) : null}
        <Text style={styles.collectLabel}>
          {cash
            ? service === 'taxi'
              ? t('ride.done.collectFromRider')
              : t('ride.done.collectFromCustomer')
            : cashNow > 0
              ? t('ride.done.collectForWaiting')
              : t('ride.done.collectNone')}
        </Text>
        <Text style={styles.collect} adjustsFontSizeToFit numberOfLines={1}>
          {digits(cashNow)}
        </Text>
        <Text style={styles.collectUnit}>{t('common.units.som')}</Text>
        {cash && deposit ? <Text style={styles.collectNote}>{deposit}</Text> : null}
        {cash && parts && !deposit ? <Text style={styles.collectNote}>{parts}</Text> : null}
        {owedNote ? <Text style={styles.collectNote}>({owedNote})</Text> : null}
        {!cash ? (
          <Text style={styles.collectNote}>
            {t('ride.flow.cashPrepaid', { amount: som(r.fare.quoted) })}
          </Text>
        ) : null}
      </View>

      <TipLine rideId={r.id} />

      {e ? (
        <Card>
          <Title>{t('ride.done.fromThisRide')}</Title>
          <Row label={t('ride.done.fare')} value={som(e.fare ?? total)} />
          {bonus > 0 ? (
            <Row label={t('ride.done.bonusCompensation')} value={som(bonus)} tone="success" />
          ) : null}
          <Row
            label={`${t('common.ledgerKind.commission')}${e.commissionNote ? ` (${COMMISSION_NOTES[e.commissionNote] ?? e.commissionNote})` : ''}`}
            value={som(-e.commission)}
          />
          <Row label={t('ride.done.tax', { percent: taxPercent })} value={som(-e.tax)} />
          <Row label={t('ride.done.net')} value={som(e.net)} strong tone="success" />
          <Muted>{t('ride.done.deductedNote')}</Muted>
          {bonus > 0 ? (
            <Muted>{t('ride.done.bonusText', { amount: som(bonus) })}</Muted>
          ) : r.discount && r.discount.amount > 0 && !cash ? (
            <Muted>{t('ride.done.discountCard')}</Muted>
          ) : null}
          {money.owedFee > 0 ? (
            <Muted>{t('ride.done.owedText', { amount: som(money.owedFee) })}</Muted>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Title>{t('ride.done.rateRider')}</Title>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              onPress={() => {
                haptics.select();
                setStars(n);
                setTags([]);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('ride.done.stars', { count: n })}
              hitSlop={6}
            >
              <Ionicons
                name={n <= stars ? 'star' : 'star-outline'}
                size={48}
                color={colors.brand}
              />
            </Pressable>
          ))}
        </View>
        {options.length ? (
          <Choice
            options={options}
            selected={tags}
            onToggle={(tag) =>
              setTags((x) => (x.includes(tag) ? x.filter((y) => y !== tag) : [...x, tag]))
            }
          />
        ) : (
          <Muted>{t('ride.done.ratingHint')}</Muted>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  collectBox: {
    backgroundColor: colors.brand,
    borderRadius: 20,
    padding: space.xl,
    alignItems: 'center',
    gap: space.xs,
  },
  collectLabel: { fontSize: 17, fontWeight: '900', color: colors.onBrand, letterSpacing: 0.5 },
  collect: {
    fontSize: 88,
    fontWeight: '900',
    color: colors.onBrand,
    fontVariant: ['tabular-nums'],
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  collectUnit: { fontSize: 26, fontWeight: '900', color: colors.onBrand, marginTop: -12 },
  collectNote: { fontSize: 16, fontWeight: '700', color: colors.onBrand },
  stars: { flexDirection: 'row', justifyContent: 'space-between' },
});
