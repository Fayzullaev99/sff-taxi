import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { intercity } from '../../api/driver';
import type { IntercityPoint } from '../../api/types';
import { keys, useDriverMe, useIntercityFare, useIntercityPoints } from '../../data/queries';
import { errorMessage } from '../../lib/api-client';
import { distance, etaMinutes, RIDE_CLASSES, som } from '../../lib/format';
import {
  departureIso,
  departureProblem,
  frontPriceFor,
  INTERCITY_RULES,
  parseTime,
  priceProblem,
  stepPrice,
} from '../../lib/intercity';
import { dayLabel, tashkentDate } from '../../lib/when';
import {
  Banner,
  Button,
  Card,
  Choice,
  ErrorState,
  Field,
  Loading,
  Muted,
  Row,
  SectionTitle,
  ToggleRow,
} from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { Screen } from '../../ui/screen';
import { colors, space } from '../../ui/theme';

const TIMES = ['06:00', '07:00', '08:00', '10:00', '13:00', '16:00', '18:00'];

/**
 * Publish a departure: route (towns with their meeting points), day and time (Tashkent),
 * seats, the front seat, and the rear seat price within ±15% of the reference (the front
 * seat keeps its proportion). The API checks everything again.
 */
export default function NewTrip() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useDriverMe();
  const points = useIntercityPoints();
  const vehicle = me.data?.vehicle ?? null;
  const rideClass = vehicle?.class ?? 'economy';
  const maxSeats = Math.min(4, vehicle?.seats ?? 4);

  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [day, setDay] = useState(() => tashkentDate(Date.now(), 1));
  const [time, setTime] = useState('07:00');
  const [seats, setSeats] = useState(String(maxSeats));
  const [frontSeat, setFrontSeat] = useState(true);
  const [price, setPrice] = useState<number | null>(null);
  const [priceText, setPriceText] = useState('');
  const [meetingPoint, setMeetingPoint] = useState('');
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // start from Guliston, the town most drivers live in
  useEffect(() => {
    if (from || !points.data?.length) return;
    setFrom((points.data.find((p) => p.slug === 'guliston') ?? points.data[0]!).slug);
  }, [from, points.data]);

  const fare = useIntercityFare(from, to, rideClass);
  const f = fare.data ?? null;
  // a new route starts at its reference price
  useEffect(() => {
    if (!f) return;
    setPrice(f.reference.rear);
    setPriceText(String(f.reference.rear));
  }, [f]);

  const publish = useMutation({
    mutationFn: () =>
      intercity.publish({
        from: from!,
        to: to!,
        departureAt: departureIso(day, parseTime(time)!),
        seats: Number(seats),
        frontSeat,
        priceRear: price,
        meetingPoint: meetingPoint.trim() || null,
        comment: comment.trim() || null,
      }),
    onSuccess: (trip) => {
      haptics.success();
      qc.setQueryData(keys.trip(trip.id), trip);
      void qc.invalidateQueries({ queryKey: keys.trips });
      router.replace(`/intercity/${trip.id}`);
    },
    onError: (error) => {
      haptics.error();
      setProblem(errorMessage(error));
    },
  });

  if (points.isPending || me.isPending) return <Loading />;
  if (!points.data) {
    return (
      <ErrorState message={errorMessage(points.error)} onRetry={() => void points.refetch()} />
    );
  }
  const towns = points.data;
  const byId = (slug: string | null): IntercityPoint | null =>
    towns.find((p) => p.slug === slug) ?? null;
  const fromPoint = byId(from);

  const submit = () => {
    const t = parseTime(time);
    if (!from || !to) return setProblem('Qayerdan va qayerga ekanini tanlang');
    if (from === to) return setProblem('Jo‘nash va borish shahri bir xil');
    if (!t) return setProblem('Vaqtni SS:DD ko‘rinishida yozing, masalan 07:30');
    const when = departureProblem(departureIso(day, t), Date.now());
    if (when) return setProblem(when);
    if (!f || price === null) return setProblem('Narx hisoblanmoqda, biroz kuting');
    const bad = priceProblem(price, f.band);
    if (bad) return setProblem(bad);
    setProblem(null);
    publish.mutate();
  };

  const days = Array.from({ length: INTERCITY_RULES.publishMaxDaysAhead }, (_, i) =>
    tashkentDate(Date.now(), i),
  );
  const front = f && price !== null ? frontPriceFor(price, f.reference) : null;

  return (
    <Screen
      keyboard
      title="Yangi qatnov"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/intercity'))}
      footer={
        <>
          {problem ? <Banner tone="danger" icon="alert-circle" text={problem} /> : null}
          <Button
            title="E’lon qilish"
            icon="megaphone"
            big
            loading={publish.isPending}
            disabled={!from || !to || !f}
            onPress={submit}
          />
        </>
      }
    >
      <SectionTitle>Qayerdan</SectionTitle>
      <Choice
        options={towns.map((p) => ({ value: p.slug, label: p.nameUz }))}
        selected={from ? [from] : []}
        onToggle={(v) => {
          setFrom(v);
          if (v === to) setTo(null);
          setProblem(null);
        }}
      />
      <SectionTitle>Qayerga</SectionTitle>
      <Choice
        options={towns.map((p) => ({ value: p.slug, label: p.nameUz }))}
        selected={to ? [to] : []}
        disabled={(v) => v === from}
        onToggle={(v) => {
          setTo(v);
          setProblem(null);
        }}
      />

      {from && to ? (
        <Card>
          {fare.isPending ? (
            <Loading />
          ) : f ? (
            <>
              <Row
                label="Masofa"
                value={`${distance(f.distanceM)}${f.durationS ? ` · ${etaMinutes(f.durationS)}` : ''}`}
              />
              <Row
                label={`Tavsiya narx (${RIDE_CLASSES[f.class] ?? f.class})`}
                value={`orqa ${som(f.reference.rear)} · old ${som(f.reference.front)}`}
              />
              <Row label="Ruxsat etilgan" value={`${som(f.band.min)} – ${som(f.band.max)}`} />
            </>
          ) : (
            <Text style={styles.error}>{errorMessage(fare.error)}</Text>
          )}
        </Card>
      ) : null}

      <SectionTitle>Qachon (Toshkent vaqti)</SectionTitle>
      <Choice
        options={days.map((d) => ({ value: d, label: dayLabel(d, Date.now()) }))}
        selected={[day]}
        onToggle={setDay}
      />
      <Choice
        options={TIMES.map((t) => ({ value: t, label: t }))}
        selected={[parseTime(time) ?? time]}
        onToggle={setTime}
      />
      <Field
        label="Jo‘nash vaqti"
        value={time}
        onChangeText={(v) => {
          setTime(v.replace(/[^\d:.]/g, ''));
          setProblem(null);
        }}
        keyboardType="numbers-and-punctuation"
        placeholder="07:30"
        maxLength={5}
      />

      <SectionTitle>O‘rinlar</SectionTitle>
      <Choice
        options={Array.from({ length: maxSeats }, (_, i) => ({
          value: String(i + 1),
          label: `${i + 1} ta`,
        }))}
        selected={[seats]}
        onToggle={setSeats}
      />
      <ToggleRow
        label="Old o‘rindiq ham sotiladi"
        description="Old o‘rindiq qimmatroq bo‘ladi"
        value={frontSeat}
        onChange={setFrontSeat}
      />

      {f && price !== null ? (
        <Card>
          <SectionTitle>Orqa o‘rindiq narxi</SectionTitle>
          <View style={styles.stepper}>
            <Button
              title="− 1 000"
              variant="secondary"
              onPress={() => {
                const next = stepPrice(price, -1000, f.band);
                setPrice(next);
                setPriceText(String(next));
              }}
              style={{ flex: 1 }}
            />
            <Button
              title="+ 1 000"
              variant="secondary"
              onPress={() => {
                const next = stepPrice(price, 1000, f.band);
                setPrice(next);
                setPriceText(String(next));
              }}
              style={{ flex: 1 }}
            />
          </View>
          <Field
            label="Narx (so‘m)"
            value={priceText}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, '');
              setPriceText(digits);
              setPrice(digits ? Number(digits) : null);
              setProblem(null);
            }}
            keyboardType="number-pad"
            maxLength={7}
            error={price !== null ? priceProblem(price, f.band) : 'Narxni yozing'}
          />
          {frontSeat && front !== null ? (
            <Row label="Old o‘rindiq" value={som(front)} strong />
          ) : null}
          <Muted>
            Narx e’lon qilingandan keyin o‘zgarmaydi. Yo‘lovchi joy uchun sizga naqd to‘laydi.
          </Muted>
        </Card>
      ) : null}

      <Field
        label="Uchrashuv joyi (ixtiyoriy)"
        value={meetingPoint}
        onChangeText={setMeetingPoint}
        placeholder={fromPoint?.meetingPoint ?? 'Avtovokzal'}
        maxLength={200}
      />
      <Field
        label="Izoh (ixtiyoriy)"
        value={comment}
        onChangeText={setComment}
        placeholder="Masalan: konditsioner bor, yuk joyi kichik"
        maxLength={500}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', gap: space.sm },
  error: { color: colors.danger, fontSize: 15, fontWeight: '600' },
});
