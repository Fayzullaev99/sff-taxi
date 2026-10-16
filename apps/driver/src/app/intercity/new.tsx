import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { intercity } from '../../api/driver';
import type { DriverTrip, IntercityPoint } from '../../api/types';
import {
  keys,
  useDriverConfig,
  useDriverMe,
  useIntercityFare,
  useIntercityPoints,
  useTrip,
} from '../../data/queries';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/api-client';
import { distance, etaMinutes, RIDE_CLASSES, som } from '../../lib/format';
import {
  departureIso,
  departureParts,
  departureProblem,
  frontPriceFor,
  maxTripSeats,
  parseTime,
  priceProblem,
  stepPrice,
  townName,
  tripEditable,
  tripEdits,
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

/** The trip's meeting point as the form shows it: empty when it is the town's own. */
function ownMeetingPoint(trip: DriverTrip): string | null {
  return trip.meetingPoint && trip.meetingPoint !== trip.from.meetingPoint
    ? trip.meetingPoint
    : null;
}

/**
 * Publish a departure: route (towns with their meeting points), day and time (Tashkent),
 * seats, the front seat, and the rear seat price within the band around the reference (the
 * front seat keeps its proportion). The time window comes from `GET /v1/driver/config`
 * (`intercity`). With `?edit=<id>` the same form changes a published trip (`PATCH`, only
 * what changed) while nobody has booked it; the route stays. The API checks everything again.
 */
export default function NewTrip() {
  const { t } = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ edit?: string }>();
  const editId = params.edit ? String(params.edit) : null;
  const me = useDriverMe();
  const rules = useDriverConfig().intercity;
  const points = useIntercityPoints();
  const edited = useTrip(editId ?? '', editId !== null);
  const trip = editId ? (edited.data ?? null) : null;
  const vehicle = me.data?.vehicle ?? null;
  const rideClass = trip?.class ?? vehicle?.class ?? 'economy';

  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [day, setDay] = useState(() => tashkentDate(Date.now(), 1));
  const [time, setTime] = useState('07:00');
  const [frontSeat, setFrontSeat] = useState(true);
  // the seating rule: 1 in front, at most 2 in the back (3 in all; 2 without the front seat)
  const maxSeats = maxTripSeats(vehicle?.seats ?? 4, frontSeat, rules);
  const [seats, setSeats] = useState(String(maxTripSeats(vehicle?.seats ?? 4, true, rules)));
  useEffect(() => {
    if (Number(seats) > maxSeats) setSeats(String(maxSeats));
  }, [seats, maxSeats]);
  const [price, setPrice] = useState<number | null>(null);
  const [priceText, setPriceText] = useState('');
  const [meetingPoint, setMeetingPoint] = useState('');
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // editing: the form starts from the trip as published (once)
  const filled = useRef(false);
  useEffect(() => {
    if (!trip || filled.current) return;
    filled.current = true;
    const at = departureParts(trip.departureAt);
    setFrom(trip.from.slug);
    setTo(trip.to.slug);
    setDay(at.date);
    setTime(at.time);
    setSeats(String(trip.seats.total));
    setFrontSeat(trip.seats.frontOffered);
    setPrice(trip.price.rear);
    setPriceText(String(trip.price.rear));
    setMeetingPoint(ownMeetingPoint(trip) ?? '');
    setComment(trip.comment ?? '');
  }, [trip]);

  // a new departure starts from Guliston, the town most drivers live in
  useEffect(() => {
    if (editId || from || !points.data?.length) return;
    setFrom((points.data.find((p) => p.slug === 'guliston') ?? points.data[0]!).slug);
  }, [editId, from, points.data]);

  const fare = useIntercityFare(from, to, rideClass);
  const f = fare.data ?? null;
  // a new route starts at its reference price (an edited trip keeps its own)
  useEffect(() => {
    if (!f || editId) return;
    setPrice(f.reference.rear);
    setPriceText(String(f.reference.rear));
  }, [f, editId]);

  const onSaved = (saved: DriverTrip) => {
    haptics.success();
    qc.setQueryData(keys.trip(saved.id), saved);
    void qc.invalidateQueries({ queryKey: keys.trips });
    router.replace(`/intercity/${saved.id}`);
  };
  const onFailed = (error: unknown) => {
    haptics.error();
    setProblem(errorMessage(error));
    if (editId) void edited.refetch();
  };

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
    onSuccess: onSaved,
    onError: onFailed,
  });

  const save = useMutation({
    mutationFn: (body: NonNullable<ReturnType<typeof tripEdits>>) => intercity.edit(editId!, body),
    onSuccess: onSaved,
    onError: onFailed,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/intercity'));
  // loading and errors keep the header's back button (the stack header is hidden)
  if (points.isPending || me.isPending || (editId && edited.isPending)) {
    return (
      <Screen title={t('intercity.trip.title')} onBack={back}>
        <Loading />
      </Screen>
    );
  }
  if (!points.data) {
    return (
      <Screen title={t('intercity.trip.title')} onBack={back}>
        <ErrorState message={errorMessage(points.error)} onRetry={() => void points.refetch()} />
      </Screen>
    );
  }
  if (editId && !trip) {
    return (
      <Screen title={t('intercity.trip.title')} onBack={back}>
        <ErrorState message={errorMessage(edited.error)} onRetry={() => void edited.refetch()} />
      </Screen>
    );
  }
  const towns = points.data;
  const byId = (slug: string | null): IntercityPoint | null =>
    towns.find((p) => p.slug === slug) ?? null;
  const fromPoint = trip?.from ?? byId(from);
  const locked = trip !== null && !tripEditable(trip);

  const submit = () => {
    const parsed = parseTime(time);
    if (!from || !to) return setProblem(t('intercity.new.chooseRoute'));
    if (from === to) return setProblem(t('intercity.new.sameTown'));
    if (!parsed) return setProblem(t('intercity.new.badTime'));
    const departureAt = departureIso(day, parsed);
    // an unchanged time of an edited trip is not checked again (it is not sent)
    const timeChanged = !trip || Date.parse(departureAt) !== Date.parse(trip.departureAt);
    const when = timeChanged ? departureProblem(departureAt, Date.now(), rules) : null;
    if (when) return setProblem(when);
    if (!f || price === null) return setProblem(t('intercity.new.priceLoading'));
    const bad = priceProblem(price, f.band);
    if (bad) return setProblem(bad);
    setProblem(null);
    if (!trip) return publish.mutate();
    const body = tripEdits(
      { ...trip, meetingPoint: ownMeetingPoint(trip) },
      {
        departureAt,
        seats: Number(seats),
        frontSeat,
        priceRear: price,
        meetingPoint,
        comment,
      },
    );
    if (!body) return setProblem(t('intercity.new.nothingChanged'));
    save.mutate(body);
  };

  const days = Array.from({ length: rules.publishMaxDaysAhead }, (_, i) =>
    tashkentDate(Date.now(), i),
  );
  if (!days.includes(day)) days.push(day);
  const front = f && price !== null ? frontPriceFor(price, f.reference) : null;
  const seatChoices = maxSeats;

  return (
    <Screen
      keyboard
      title={
        trip ? t('intercity.new.editTitle', { number: trip.number }) : t('intercity.new.title')
      }
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/intercity'))}
      footer={
        <>
          {problem ? <Banner tone="danger" icon="alert-circle" text={problem} /> : null}
          <Button
            title={trip ? t('common.actions.save') : t('intercity.new.publish')}
            icon={trip ? 'checkmark' : 'megaphone'}
            big
            loading={publish.isPending || save.isPending}
            disabled={!from || !to || !f || locked}
            onPress={submit}
          />
        </>
      }
    >
      {trip ? (
        <Card>
          <Text style={styles.route}>
            {townName(trip.from)} → {townName(trip.to)}
          </Text>
          <Muted>{t('intercity.new.routeLocked')}</Muted>
          {locked ? (
            <Banner tone="warning" icon="lock-closed" text={t('intercity.new.locked')} />
          ) : null}
        </Card>
      ) : (
        <>
          <SectionTitle>{t('intercity.new.from')}</SectionTitle>
          <Choice
            options={towns.map((p) => ({ value: p.slug, label: townName(p) }))}
            selected={from ? [from] : []}
            onToggle={(v) => {
              setFrom(v);
              if (v === to) setTo(null);
              setProblem(null);
            }}
          />
          <SectionTitle>{t('intercity.new.to')}</SectionTitle>
          <Choice
            options={towns.map((p) => ({ value: p.slug, label: townName(p) }))}
            selected={to ? [to] : []}
            disabled={(v) => v === from}
            onToggle={(v) => {
              setTo(v);
              setProblem(null);
            }}
          />
        </>
      )}

      {from && to ? (
        <Card>
          {fare.isPending ? (
            <Loading />
          ) : f ? (
            <>
              <Row
                label={t('intercity.new.distance')}
                value={`${distance(f.distanceM)}${f.durationS ? ` · ${etaMinutes(f.durationS)}` : ''}`}
              />
              <Row
                label={t('intercity.new.referencePrice', {
                  class: RIDE_CLASSES[f.class] ?? f.class,
                })}
                value={t('intercity.new.referenceValue', {
                  rear: som(f.reference.rear),
                  front: som(f.reference.front),
                })}
              />
              <Row
                label={t('intercity.new.allowed', { percent: rules.priceBandPercent })}
                value={`${som(f.band.min)} – ${som(f.band.max)}`}
              />
            </>
          ) : (
            <>
              <Text style={styles.error}>{errorMessage(fare.error)}</Text>
              {/* without the price band the trip cannot be published: let the driver retry */}
              <Button
                title={t('common.actions.retry')}
                icon="refresh"
                variant="secondary"
                loading={fare.isFetching}
                onPress={() => void fare.refetch()}
              />
            </>
          )}
        </Card>
      ) : null}

      <SectionTitle>{t('intercity.new.when')}</SectionTitle>
      <Choice
        options={days.map((d) => ({ value: d, label: dayLabel(d, Date.now()) }))}
        selected={[day]}
        onToggle={setDay}
      />
      <Choice
        options={TIMES.map((x) => ({ value: x, label: x }))}
        selected={[parseTime(time) ?? time]}
        onToggle={setTime}
      />
      <Field
        label={t('intercity.new.departureTime')}
        value={time}
        onChangeText={(v) => {
          setTime(v.replace(/[^\d:.]/g, ''));
          setProblem(null);
        }}
        keyboardType="numbers-and-punctuation"
        placeholder="07:30"
        maxLength={5}
        hint={t('intercity.new.timeHint', {
          minMinutes: rules.publishMinMinutesAhead,
          maxDays: rules.publishMaxDaysAhead,
          spacingHours: rules.tripSpacingHours,
        })}
      />

      <SectionTitle>{t('intercity.new.seats')}</SectionTitle>
      <Choice
        options={Array.from({ length: seatChoices }, (_, i) => ({
          value: String(i + 1),
          label: t('intercity.new.seatCount', { count: i + 1 }),
        }))}
        selected={[seats]}
        onToggle={setSeats}
      />
      <ToggleRow
        label={t('intercity.new.frontSeatSold')}
        description={t('intercity.new.frontSeatHint')}
        value={frontSeat}
        onChange={setFrontSeat}
      />

      {f && price !== null ? (
        <Card>
          <SectionTitle>{t('intercity.new.rearPrice')}</SectionTitle>
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
            label={t('intercity.new.price')}
            value={priceText}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, '');
              setPriceText(digits);
              setPrice(digits ? Number(digits) : null);
              setProblem(null);
            }}
            keyboardType="number-pad"
            maxLength={7}
            error={price !== null ? priceProblem(price, f.band) : t('intercity.new.priceRequired')}
          />
          {frontSeat && front !== null ? (
            <Row label={t('intercity.seats.front')} value={som(front)} strong />
          ) : null}
          <Muted>{t('intercity.new.priceNote')}</Muted>
        </Card>
      ) : null}

      <Field
        label={t('intercity.new.meetingPoint')}
        value={meetingPoint}
        onChangeText={setMeetingPoint}
        placeholder={fromPoint?.meetingPoint ?? t('intercity.new.meetingPlaceholder')}
        maxLength={200}
      />
      <Field
        label={t('intercity.new.comment')}
        value={comment}
        onChangeText={setComment}
        placeholder={t('intercity.new.commentPlaceholder')}
        maxLength={500}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  route: { fontSize: 22, fontWeight: '900', color: colors.text },
  stepper: { flexDirection: 'row', gap: space.sm },
  error: { color: colors.danger, fontSize: 15, fontWeight: '600' },
});
