import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { serverClock } from '../../api/client';
import { errorMessage } from '../../lib/api-client';
import { driver } from '../../api/driver';
import type { DriverRide, Offer } from '../../api/types';
import { keys, useDriverConfig, useStreamOpen } from '../../data/queries';
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
import { alongLine, alongStopLines, offerBadges, ridePool } from '../../lib/pool';
import { acceptOffer } from '../../lib/ride-actions';
import {
  cargoLines,
  customerWord,
  parcelLines,
  SERVICE_LABELS,
  serviceOf,
} from '../../lib/service';
import {
  OFFER_FAILURE_TEXT,
  type OfferFailure,
  offerFailure,
  offerOwedFeeLine,
} from '../../lib/ride-flow';
import { scheduledLabel } from '../../lib/when';
import { announceOffer, dismissNotification, OFFER_VIBRATION } from '../../notifications/push';
import { handledOffers } from '../../realtime/driver-runtime';
import { useOfferClosed } from '../../realtime/use-realtime';
import { Banner, Button, Chip, ErrorState, Loading, Muted } from '../../ui/components';
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

/** The ring redraws this often: smooth enough, cheap on a low-end phone. */
const RING_TICK_MS = 250;
/** The rest of the screen only needs to notice the end of the offer. */
const SCREEN_TICK_MS = 1_000;
/** An accept that got no answer gives up after this (the offer lasts 15 s). */
const ACCEPT_TIMEOUT_MS = 8_000;

type Lengths = { direct: number; broadcast: number };

function useServerNow(everyMs: number, on = true): number {
  const [now, setNow] = useState(() => serverClock.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(serverClock.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs, on]);
  return now;
}

/** The ring with its own fast tick, so the rest of the screen is not redrawn 4× a second. */
const LiveCountdown = memo(function LiveCountdown(props: {
  expiresAt: string;
  kind: string;
  lengths: Lengths;
  size: number;
}) {
  const now = useServerNow(RING_TICK_MS);
  const c = offerCountdown({
    expiresAt: props.expiresAt,
    kind: props.kind,
    serverNow: now,
    lengths: props.lengths,
  });
  return (
    <CountdownRing seconds={c.seconds} fraction={c.fraction} urgent={c.urgent} size={props.size} />
  );
});

/**
 * A ride offer, full-screen: 15 s countdown ring (30 s for a broadcast), loud sound and
 * vibration, the fixed fare, how far the pickup is, where the rider goes, payment and
 * options. Accept is one big tap (a second tap does nothing; a lost answer is re-sent and
 * checked against the driver's ride); declining asks for an optional reason. An offer that
 * is taken by another driver or withdrawn says so at once.
 */
export default function OfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offerId = String(id).toLowerCase();
  const router = useRouter();
  const qc = useQueryClient();
  const { width, height } = useWindowDimensions();
  // a landscape tablet (or a phone on its side in a holder): the buttons go to the right
  const wide = width >= 700 && width > height;

  const config = useDriverConfig();
  const lengths = {
    direct: config.rides.offerTimeoutSeconds,
    broadcast: config.rides.broadcastTimeoutSeconds,
  };
  const streamOpen = useStreamOpen();
  // from the list that opened it, or fetched (opened from a push). `offer.closed` closes the
  // screen at once; re-checking the list is only the fallback for a missed event (every 3 s
  // without the stream, rarely with it).
  const offers = useQuery({
    queryKey: keys.offers,
    queryFn: driver.offers,
    refetchOnMount: 'always',
    refetchInterval: streamOpen ? 10_000 : 3_000,
  });
  const cached = offers.data?.find((o) => o.id.toLowerCase() === offerId);
  const [offer, setOffer] = useState<Offer | null>(cached ?? null);
  useEffect(() => {
    if (cached && !offer) setOffer(cached);
  }, [cached, offer]);

  // riders already in the car, by ride id: the along-the-way plan names them
  const inHand = qc.getQueryData<DriverRide | null>(keys.current) ?? null;
  const [riderNames] = useState(() => {
    const m = new Map<string, string | null>();
    if (inHand) m.set(inHand.id, inHand.rider?.name ?? null);
    for (const st of ridePool(inHand)?.stops ?? []) m.set(st.rideId, st.riderName ?? null);
    return m;
  });

  const closedStatus = useOfferClosed(offerId);
  const [declining, setDeclining] = useState(false);
  const [failure, setFailure] = useState<OfferFailure | null>(null);
  const [retrying, setRetrying] = useState(false);
  /** Set on the first tap of accept or decline: every later tap is ignored. */
  const answered = useRef(false);
  const [answering, setAnswering] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    handledOffers.add(offerId);
  }, [offerId]);

  const now = useServerNow(SCREEN_TICK_MS, !answering);
  const countdown = offer
    ? offerCountdown({ expiresAt: offer.expiresAt, kind: offer.kind, serverNow: now, lengths })
    : null;
  // the server said the offer is over (taken, withdrawn, expired): the screen closes at once
  const closedByServer = closedStatus !== null && !answered.current && failure === null;
  const closed: OfferFailure | null =
    (failure && failure !== 'network' ? failure : null) ??
    (closedByServer ? (CLOSED_TEXT[closedStatus] ?? 'gone') : null) ??
    (countdown?.expired && !answered.current ? 'expired' : null) ??
    // gone from the server's list: taken by another driver, or the rider cancelled
    // (a list that failed to load says nothing: shown as an error with a retry instead)
    (offers.isFetchedAfterMount && !offers.isError && !cached && !answered.current
      ? countdown && countdown.seconds <= 2
        ? 'expired'
        : 'gone'
      : null);

  // sound (once per offer) + vibration + screen on while it is open and unanswered
  const alive = offer !== null && closed === null && !answering;
  useEffect(() => {
    if (!alive || !offer) return;
    let notification: string | null = null;
    let cancelled = false;
    void announceOffer(
      offer.id,
      `Yangi buyurtma: ${som(offer.ride.fare)}`,
      offer.ride.pickup.address ?? offer.ride.pickup.landmark ?? '',
    ).then((n) => {
      notification = n;
      if (cancelled) void dismissNotification(n);
    });
    Vibration.vibrate(OFFER_VIBRATION, true);
    activateKeepAwakeAsync('offer').catch(() => undefined);
    return () => {
      cancelled = true;
      Vibration.cancel();
      void dismissNotification(notification);
      deactivateKeepAwake('offer').catch(() => undefined);
    };
  }, [alive, offer]);

  useEffect(() => {
    if (closed) haptics.warning();
  }, [closed]);

  const accept = useMutation({
    mutationFn: () =>
      acceptOffer({
        accept: () => driver.accept(offerId, ACCEPT_TIMEOUT_MS),
        currentRide: async () => (await driver.currentRide()).ride,
        rideId: offer!.ride.id,
        retry: {
          alive: () => mounted.current,
          onRetry: () => setRetrying(true),
        },
      }),
    onSuccess: (ride) => {
      haptics.success();
      qc.setQueryData(keys.current, ride);
      qc.setQueryData<Offer[]>(keys.offers, []);
      void qc.invalidateQueries({ queryKey: keys.me });
      router.replace('/ride');
    },
    onError: (error) => {
      const why = offerFailure(error);
      // no answer at all: the driver may tap again while the offer lasts
      if (why === 'network') {
        answered.current = false;
        setAnswering(false);
      }
      setRetrying(false);
      haptics.error();
      setFailure(why);
      void qc.invalidateQueries({ queryKey: keys.offers });
      void qc.invalidateQueries({ queryKey: keys.current });
    },
  });

  const onAccept = () => {
    if (answered.current || !offer) return;
    answered.current = true;
    setAnswering(true);
    setFailure(null);
    haptics.tap();
    accept.mutate();
  };

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  const decline = (reason: string | null) => {
    if (answered.current) return;
    answered.current = true;
    haptics.tap();
    // answered at once so the next driver is asked; the screen does not wait for it
    void driver.decline(offerId, reason).catch(() => undefined);
    qc.setQueryData<Offer[]>(keys.offers, (list) => list?.filter((o) => o.id !== offer?.id));
    close();
  };

  // closed by the server: gone at once (the vibration tells the driver); closed otherwise
  // (expired here, vanished from the list): the reason stays on screen for a moment
  useEffect(() => {
    if (!closed || closed === 'other') return;
    const t = setTimeout(close, closedByServer ? 0 : 4_000);
    return () => clearTimeout(t);
  }, [closed, closedByServer, close]);

  // opened from a push before the list arrived: a way out while it loads, and a failed
  // load is said as such (not "taken by another driver")
  if (!offer && !closed) {
    return (
      <SafeAreaView style={styles.safe}>
        {offers.isError ? (
          <ErrorState message={errorMessage(offers.error)} onRetry={() => void offers.refetch()} />
        ) : (
          <Loading />
        )}
        <View style={styles.loadingClose}>
          <Button title="Yopish" variant="secondary" onPress={close} />
        </View>
      </SafeAreaView>
    );
  }

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

  const ringSize = width < 380 ? 118 : wide ? 170 : 150;
  const actions = (
    <View style={[styles.actions, wide && styles.actionsWide]}>
      {failure === 'network' ? (
        <Banner
          tone="danger"
          icon="cloud-offline"
          text="Javob yetib bormadi: internet yo‘q. Aloqa bo‘lsa, yana bosing."
        />
      ) : null}
      {declining ? (
        <>
          <Text style={styles.reasonTitle}>Nega? (ixtiyoriy)</Text>
          <View style={styles.reasons}>
            {config.declineReasons.map((d) => (
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
            title={retrying ? 'Aloqa sust — qayta yuborilmoqda…' : 'QABUL QILISH'}
            icon="checkmark-circle"
            variant="success"
            big
            loading={answering && !retrying}
            disabled={answering}
            onPress={onAccept}
            style={styles.accept}
            accessibilityHint="Buyurtmani olish"
          />
          <Button
            title="O‘tkazib yuborish"
            variant="secondary"
            disabled={answering}
            onPress={() => {
              haptics.select();
              setDeclining(true);
            }}
          />
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <OfflineBanner />
      <View style={[styles.body, wide && { flexDirection: 'row' }]}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <View style={styles.top}>
            <LiveCountdown
              expiresAt={offer.expiresAt}
              kind={offer.kind}
              lengths={lengths}
              size={ringSize}
            />
            <OfferHeadline offer={offer} />
          </View>
          <AlongPlan offer={offer} names={riderNames} />
          <OfferDetails offer={offer} minute={Math.floor(now / 60_000)} />
        </ScrollView>
        {actions}
      </View>
    </SafeAreaView>
  );
}

/** Fare, owed fee and chips: redrawn only when the offer changes. */
const OfferHeadline = memo(function OfferHeadline({ offer }: { offer: Offer }) {
  const r = offer.ride;
  // fees the rider owes from earlier cancelled cash rides: taken in cash with this fare
  const owedLine = offerOwedFeeLine(r.owedFee);
  return (
    <View style={{ flex: 1, gap: space.xs }}>
      <Text style={styles.fare} adjustsFontSizeToFit numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {digits(r.fare)}
      </Text>
      <Text style={styles.fareUnit} maxFontSizeMultiplier={1.4}>
        so‘m · narx o‘zgarmaydi
      </Text>
      {owedLine ? <Text style={styles.owed}>{owedLine}</Text> : null}
      <View style={styles.chips}>
        <Chip
          label={PAYMENT_METHODS[r.paymentMethod] ?? r.paymentMethod}
          tone={r.paymentMethod === 'cash' ? 'success' : 'info'}
          icon={r.paymentMethod === 'cash' ? 'cash' : 'card'}
        />
        <Chip label={RIDE_CLASSES[r.class] ?? r.class} tone="neutral" />
        {r.kind === 'intercity' ? <Chip label="Shaharlararo" tone="warning" /> : null}
        {offerBadges(r).map((b) => (
          <Chip key={b.label} label={b.label} tone={b.tone} />
        ))}
      </View>
    </View>
  );
});

/** An offer on the car's way: how much longer the trip gets and the new order of stops. */
const AlongPlan = memo(function AlongPlan(props: {
  offer: Offer;
  names: ReadonlyMap<string, string | null>;
}) {
  const along = props.offer.along;
  if (!along) return null;
  const lines = alongStopLines(along.stops ?? [], props.offer.ride.id, props.names);
  return (
    <View style={styles.along}>
      <View style={styles.alongHead}>
        <Ionicons name="git-merge" size={22} color={colors.brand} />
        <Text style={styles.alongTitle}>{alongLine(along.detourS)}</Text>
      </View>
      {lines.map((l, i) => (
        <Text key={l.key} style={[styles.alongStop, l.isNew && { color: colors.brand }]}>
          {i + 1}. {l.text}
        </Text>
      ))}
    </View>
  );
});

/** Where and when: redrawn when the offer or the minute changes (the "in 25 min" label). */
const OfferDetails = memo(function OfferDetails(props: { offer: Offer; minute: number }) {
  const { offer } = props;
  const r = offer.ride;
  const scheduled = scheduledLabel(r.scheduledFor, props.minute * 60_000);
  const pickupText = r.pickup.address ?? r.pickup.landmark ?? 'Xaritadagi nuqta';
  const service = serviceOf(r);
  // cargo: class, loaders, weight, the load, the customer riding along; delivery: the parcel
  // (the recipient is shown only after accepting)
  const serviceLines =
    service === 'cargo'
      ? cargoLines(r.cargo, r.class)
      : service === 'delivery'
        ? parcelLines(r.parcel)
        : [];
  return (
    <>
      {serviceLines.length ? (
        <View style={styles.service}>
          <View style={styles.alongHead}>
            <Ionicons name={service === 'cargo' ? 'cube' : 'mail'} size={22} color={colors.info} />
            <Text style={styles.serviceTitle}>{SERVICE_LABELS[service]}</Text>
          </View>
          {serviceLines.map((l) => (
            <Text key={l} style={styles.alongStop}>
              {l}
            </Text>
          ))}
        </View>
      ) : null}
      {scheduled ? (
        <View style={styles.scheduled}>
          <Ionicons name="calendar" size={22} color={colors.info} />
          <Text style={styles.scheduledText}>{scheduled}</Text>
        </View>
      ) : null}

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
        {customerWord(service)} reytingi: {r.riderRating.toFixed(1)} ★ · #{r.number}
      </Muted>
    </>
  );
});

const styles = StyleSheet.create({
  loadingClose: { padding: 16 },
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  content: { padding: space.lg, gap: space.lg },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  fare: { fontSize: 52, fontWeight: '900', color: colors.brand, fontVariant: ['tabular-nums'] },
  fareUnit: { fontSize: 15, color: colors.muted, fontWeight: '700' },
  owed: { fontSize: 15, color: colors.success, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  broadcast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.warningSoft,
    padding: space.md,
    borderRadius: radius.md,
  },
  scheduled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.infoSoft,
    padding: space.md,
    borderRadius: radius.md,
  },
  scheduledText: { flex: 1, color: colors.info, fontWeight: '800', fontSize: 17 },
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
  actionsWide: {
    width: 380,
    justifyContent: 'center',
    borderTopWidth: 0,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
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
  along: {
    gap: space.xs,
    backgroundColor: colors.brandSoft,
    padding: space.md,
    borderRadius: radius.md,
  },
  alongHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  service: {
    gap: space.xs,
    backgroundColor: colors.infoSoft,
    padding: space.md,
    borderRadius: radius.md,
  },
  serviceTitle: { flex: 1, color: colors.info, fontSize: 18, fontWeight: '900' },
  alongTitle: { flex: 1, color: colors.brand, fontSize: 18, fontWeight: '900' },
  alongStop: { color: colors.text, fontSize: 16, fontWeight: '700' },
  closed: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
  closedTitle: { fontSize: 26, fontWeight: '900', color: colors.text, textAlign: 'center' },
});
