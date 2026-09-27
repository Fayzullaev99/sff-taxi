import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { driver } from '../../api/driver';
import { useRide } from '../../data/queries';
import { errorMessage } from '../../lib/api-client';
import { COMMISSION_NOTES, digits, som } from '../../lib/format';
import { amountToCollect, cashToCollect } from '../../lib/ride-flow';
import { Banner, Button, Card, Choice, Loading, Muted, Row, Title } from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { Screen } from '../../ui/screen';
import { colors, space } from '../../ui/theme';

const GOOD_TAGS = ['O‘z vaqtida chiqdi', 'Xushmuomala', 'Toza', 'Manzilni aniq aytdi'];
const BAD_TAGS = ['Kechikdi', 'Qo‘pol', 'Salonni ifloslatdi', 'Manzil noto‘g‘ri'];

/** After "Yakunlash": the cash to take, shown huge; what the ride earned; rate the rider. */
export default function RideDone() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const ride = useRide(String(id));
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);

  const rate = useMutation({
    mutationFn: () => driver.rateRider(String(id), stars, tags, null),
    onSuccess: () => {
      haptics.success();
      router.replace('/home');
    },
    onError: () => haptics.error(),
  });

  if (!ride.data) return <Loading />;
  const r = ride.data;
  const cash = r.paymentMethod === 'cash';
  const total = amountToCollect(r.fare);
  // a card ride was prepaid: only the paid waiting is taken in cash
  const cashNow = cashToCollect(r.paymentMethod, r.fare);
  const e = r.earnings;
  const options = stars >= 4 ? GOOD_TAGS : stars > 0 ? BAD_TAGS : [];

  return (
    <Screen
      footer={
        <>
          {rate.error ? (
            <Banner tone="danger" icon="alert-circle" text={errorMessage(rate.error)} />
          ) : null}
          <Button
            title={stars ? 'Baholash va davom etish' : 'Davom etish'}
            big
            icon="arrow-forward"
            loading={rate.isPending}
            onPress={() => (stars ? rate.mutate() : router.replace('/home'))}
          />
        </>
      }
    >
      <View style={styles.collectBox}>
        <Ionicons name={cash ? 'cash' : 'card'} size={40} color={colors.onBrand} />
        <Text style={styles.collectLabel}>
          {cash
            ? 'YO‘LOVCHIDAN NAQD OLING'
            : cashNow > 0
              ? 'KUTISH UCHUN NAQD OLING'
              : 'NAQD OLMANG'}
        </Text>
        <Text style={styles.collect} adjustsFontSizeToFit numberOfLines={1}>
          {digits(cashNow)}
        </Text>
        <Text style={styles.collectUnit}>so‘m</Text>
        {cash && r.fare.waiting > 0 ? (
          <Text style={styles.collectNote}>
            {som(r.fare.quoted)} + kutish {som(r.fare.waiting)}
          </Text>
        ) : null}
        {!cash ? (
          <Text style={styles.collectNote}>
            Safar narxi {som(r.fare.quoted)} kartada oldindan to‘langan — balansingizga yoziladi
          </Text>
        ) : null}
      </View>

      {e ? (
        <Card>
          <Title>Bu safardan</Title>
          <Row label="Safar narxi" value={som(e.fare ?? total)} />
          <Row
            label={`Komissiya${e.commissionNote ? ` (${COMMISSION_NOTES[e.commissionNote] ?? e.commissionNote})` : ''}`}
            value={som(-e.commission)}
          />
          <Row label="Soliq 1% (davlatga, siz uchun to‘lanadi)" value={som(-e.tax)} />
          <Row label="Sizga qoladi" value={som(e.net)} strong tone="success" />
          <Muted>Komissiya va soliq balansingizdan yechildi; naqd pul to‘liq sizda qoladi.</Muted>
        </Card>
      ) : null}

      <Card>
        <Title>Yo‘lovchini baholang</Title>
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
              accessibilityLabel={`${n} yulduz`}
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
            options={options.map((t) => ({ value: t, label: t }))}
            selected={tags}
            onToggle={(t) => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
          />
        ) : (
          <Muted>Bahoingiz boshqa haydovchilarga yo‘lovchi haqida ma’lumot beradi.</Muted>
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
