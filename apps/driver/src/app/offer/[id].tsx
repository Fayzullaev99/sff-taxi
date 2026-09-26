import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { serverClock } from '../../api/client';
import { driver } from '../../api/driver';
import type { Offer } from '../../api/types';
import { keys } from '../../data/queries';
import { offerCountdown } from '../../lib/countdown';
import {
  digits,
  distance,
  etaMinutes,
  PAYMENT_METHODS,
  RIDE_CLASSES,
  RIDE_OPTIONS,
  som,
} from '../../lib/format';
import {
  DECLINE_REASONS,
  OFFER_FAILURE_TEXT,
  type OfferFailure,
  offerFailure,
} from '../../lib/ride-flow';
import { announceOffer, dismissNotification, OFFER_VIBRATION } from '../../notifications/push';
import { handledOffers } from '../../realtime/driver-runtime';
import { useOfferClosed } from '../../realtime/use-realtime';
import { Button, Chip, Loading, Muted } from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { OfflineBanner } from '../../ui/screen';
import { colors, radius, space } from '../../ui/theme';
import { CountdownRing } from '../../ui/widgets';

const CLOSED_TEXT: Record<string, OfferFailure> = {
  expired: 'expired',
  withdrawn: 'gone',
  declined: 'expired',
  accepted: 'taken',
  lost: 'taken',
};

/** Re-render the countdown this often: smooth enough, cheap on a low-end phone. */
const TICK_MS = 250;

/**
 * A ride offer, full-screen: 15 s countdown ring (30 s for a broadcast), loud sound and
 * vibration, the fixed fare, how far the pickup is, where the rider goes, payment and
 * options. Accept is one big tap; declining asks for an optional reason. An offer that is
 * taken by another driver or withdrawn says so at once.
 */
export default function OfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offerId = String(id).toLowerCase();
  const router = useRouter();
  const qc = useQueryClient();

  // from the list that opened it, or fetched (opened from a push). Polled while open: the
  // API does not send offer.closed when another driver takes the ride (README, API gaps).
  const offers = useQuery({
    queryKey: keys.offers,
    queryFn: driver.offers,
    refetchOnMount: 'always',
    refetchInterval: 3_000,
  });
  const cached = offers.data?.find((o) => o.id.toLowerCase() === offerId);
  const [offer, setOffer] = useState<Offer | null>(cached ?? null);
  useEffect(() => {
    if (cached && !offer) setOffer(cached);
  }, [cached, offer]);

  const closedStatus = useOfferClosed(offerId);
  const [now, setNow] = useState(() => serverClock.now());
  const [declining, setDeclining] = useState(false);
  const [failure, setFailure] = useState<OfferFailure | null>(null);
  const answered = useRef(false);

  useEffect(() => {
    handledOffers.add(offerId);
    const t = setInterval(() => setNow(serverClock.now()), TICK_MS);
    return () => clearInterval(t);
  }, [offerId]);

  const countdown = offer
    ? offerCountdown({ expiresAt: offer.expiresAt, kind: offer.kind, serverNow: now })
    : null;
  const closed: OfferFailure | null =
    failure ??
    (closedStatus && !answered.current ? (CLOSED_TEXT[closedStatus] ?? 'gone') : null) ??
    (countdown?.expired && !answered.current ? 'expired' : null) ??
    // gone from the server's list: taken by another driver, or the rider cancelled
    (offers.isFetchedAfterMount && !cached && !answered.current
      ? countdown && countdown.seconds <= 2
        ? 'expired'
        : 'gone'
      : null);

  // sound (once per offer) + vibration + screen on while it is open and unanswered
  const alive = offer !== null && closed === null;
  useEffect(() => {
    if (!alive || !offer) return;
    let notification: string | null = null;
    void announceOffer(
      offer.id,
      `Yangi buyurtma: ${som(offer.ride.fare)}`,
      offer.ride.pickup.address ?? offer.ride.pickup.landmark ?? '',
    ).then((n) => (notification = n));
    Vibration.vibrate(OFFER_VIBRATION, true);
    activateKeepAwakeAsync('offer').catch(() => undefined);
    return () => {
      Vibration.cancel();
      void dismissNotification(notification);
      deactivateKeepAwake('offer').catch(() => undefined);
    };
  }, [alive, offer]);

  useEffect(() => {
    if (closed && closed !== 'network') haptics.warning();
  }, [closed]);

  const accept = useMutation({
    mutationFn: () => driver.accept(offerId),
    onMutate: () => {
      answered.current = true;
    },
    onSuccess: (ride) => {
      haptics.success();
      qc.setQueryData(keys.current, ride);
      qc.setQueryData<Offer[]>(keys.offers, []);
      void qc.invalidateQueries({ queryKey: keys.me });
      router.replace('/ride');
    },
    onError: (error) => {
      answered.current = false;
      haptics.error();
      setFailure(offerFailure(error));
      void qc.invalidateQueries({ queryKey: keys.offers });
      void qc.invalidateQueries({ queryKey: keys.current });
    },
  });

  const decline = (reason: string | null) => {
    answered.current = true;
    haptics.tap();
    // answered at once so the next driver is asked; the screen does not wait for it
    void driver.decline(offerId, reason).catch(() => undefined);
    qc.setQueryData<Offer[]>(keys.offers, (list) => list?.filter((o) => o.id !== offer?.id));
    close();
  };

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  // an offer that closed goes away by itself after a moment
  useEffect(() => {
    if (!closed || closed === 'network' || closed === 'other') return;
    const t = setTimeout(close, 4_000);
    return () => clearTimeout(t);
  }, [closed, close]);

  if (!offer && !closed) return <Loading />;

  if (closed || !offer || !countdown) {
    const text = OFFER_FAILURE_TEXT[closed ?? 'gone'];
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.closed}>
          <Ionicons name={closed === 'taken' ? 'people' : 'time'} size={80} color={colors.muted} />
          <Text style={styles.closedTitle}>{text.title}</Text>
          <Muted center>{text.text}</Muted>
          <Button title="Yopish" big onPress={close} style={{ alignSelf: 'stretch' }} />
        </View>
      </SafeAreaView>
    );
  }

  const r = offer.ride;
  const pickupText = r.pickup.address ?? r.pickup.landmark ?? 'Xaritadagi nuqta';
  return (
    <SafeAreaView style={styles.safe}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <CountdownRing
            seconds={countdown.seconds}
            fraction={countdown.fraction}
            urgent={countdown.urgent}
            size={150}
          />
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={styles.fare} adjustsFontSizeToFit numberOfLines={1}>
              {digits(r.fare)}
            </Text>
            <Text style={styles.fareUnit}>so‘m · narx o‘zgarmaydi</Text>
            <View style={styles.chips}>
              <Chip
                label={PAYMENT_METHODS[r.paymentMethod] ?? r.paymentMethod}
                tone={r.paymentMethod === 'cash' ? 'success' : 'info'}
                icon={r.paymentMethod === 'cash' ? 'cash' : 'card'}
              />
              <Chip label={RIDE_CLASSES[r.class] ?? r.class} tone="neutral" />
              {r.kind === 'intercity' ? <Chip label="Shaharlararo" tone="warning" /> : null}
            </View>
          </View>
        </View>

        {offer.kind === 'broadcast' ? (
          <View style={styles.broadcast}>
            <Ionicons name="megaphone" size={18} color={colors.warning} />
            <Text style={styles.broadcastText}>
              Efir: bir nechta haydovchiga yuborildi, birinchi qabul qilgan oladi
            </Text>
          </View>
        ) : null}

        <View style={styles.leg}>
          <View style={[styles.dot, { backgroundColor: colors.brand }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.legLabel}>
              Mijozgacha {offer.distanceM != null ? distance(offer.distanceM) : ''}
              {offer.etaS != null ? ` · ${etaMinutes(offer.etaS)}` : ''}
            </Text>
            <Text style={styles.legPlace} numberOfLines={2}>
              {pickupText}
            </Text>
            {r.pickup.address && r.pickup.landmark ? (
              <Text style={styles.landmark} numberOfLines={1}>
                Mo‘ljal: {r.pickup.landmark}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.leg}>
          <View style={[styles.dot, { backgroundColor: colors.text }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.legLabel}>Manzil · {distance(r.distanceM)}</Text>
            <Text style={styles.legPlace} numberOfLines={2}>
              {r.dropoff.address ?? r.dropoff.landmark ?? 'Xaritadagi nuqta'}
            </Text>
          </View>
        </View>

        {r.options.length || r.comment ? (
          <View style={styles.extras}>
            {r.options.map((o) => (
              <Chip key={o} label={RIDE_OPTIONS[o] ?? o} tone="brand" />
            ))}
            {r.comment ? <Text style={styles.comment}>“{r.comment}”</Text> : null}
          </View>
        ) : null}
        <Muted>
          Yo‘lovchi reytingi: {r.riderRating.toFixed(1)} ★ · #{r.number}
        </Muted>
      </ScrollView>

      <View style={styles.actions}>
        {declining ? (
          <>
            <Text style={styles.reasonTitle}>Nega? (ixtiyoriy)</Text>
            <View style={styles.reasons}>
              {DECLINE_REASONS.map((d) => (
                <Pressable
                  key={d.code}
                  onPress={() => decline(d.code)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.reason, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.reasonText}>{d.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <Button
                title="Sababsiz rad etish"
                variant="danger"
                onPress={() => decline(null)}
                style={{ flex: 1 }}
              />
              <Button
                title="Orqaga"
                variant="secondary"
                onPress={() => setDeclining(false)}
                style={{ flex: 1 }}
              />
            </View>
          </>
        ) : (
          <>
            <Button
              title="QABUL QILISH"
              icon="checkmark-circle"
              variant="success"
              big
              loading={accept.isPending}
              onPress={() => accept.mutate()}
              style={styles.accept}
            />
            <Button
              title="O‘tkazib yuborish"
              variant="secondary"
              disabled={accept.isPending}
              onPress={() => {
                haptics.select();
                setDeclining(true);
              }}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.lg, gap: space.lg },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  fare: { fontSize: 52, fontWeight: '900', color: colors.brand, fontVariant: ['tabular-nums'] },
  fareUnit: { fontSize: 15, color: colors.muted, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  broadcast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.warningSoft,
    padding: space.md,
    borderRadius: radius.md,
  },
  broadcastText: { flex: 1, color: colors.warning, fontWeight: '700', fontSize: 15 },
  leg: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  dot: { width: 16, height: 16, borderRadius: 8, marginTop: 4 },
  legLabel: { fontSize: 15, color: colors.muted, fontWeight: '700' },
  legPlace: { fontSize: 21, color: colors.text, fontWeight: '800', marginTop: 2 },
  landmark: { fontSize: 15, color: colors.muted, marginTop: 2 },
  extras: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  comment: { fontSize: 16, color: colors.text, fontStyle: 'italic', width: '100%' },
  actions: {
    padding: space.lg,
    gap: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  accept: { minHeight: 84 },
  reasonTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  reason: {
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  reasonText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', gap: space.sm },
  closed: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
  closedTitle: { fontSize: 26, fontWeight: '900', color: colors.text, textAlign: 'center' },
});
