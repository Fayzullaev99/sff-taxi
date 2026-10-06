import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { driver } from '../../api/driver';
import type { DriverMe, DriverRide } from '../../api/types';
import {
  keys,
  useCurrentRide,
  useDriverConfig,
  useDriverMe,
  useEarnings,
} from '../../data/queries';
import { ApiError, errorMessage, isApiError } from '../../lib/api-client';
import { tashkentToday } from '../../lib/application';
import { som } from '../../lib/format';
import { balanceStatus, promoStatus } from '../../lib/money';
import { withRetry } from '../../lib/ride-actions';
import {
  ensureLocationPermission,
  requestBackgroundPermission,
  restartTracking,
  sendCurrentPosition,
} from '../../location/tracker';
import { CurrentRideCard } from '../../home/current-ride-card';
import { PoolPanel } from '../../home/pool-panel';
import { isCargoCar } from '../../lib/service';
import { useBatteryOptimization } from '../../location/use-battery-optimization';
import { useTrackingMode } from '../../location/use-tracking-mode';
import { registerPushDevice, requestPushPermission } from '../../notifications/push';
import { usePushPermission } from '../../notifications/use-push';
import { Banner, Button, Card, ErrorState, Loading, Row, Title } from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { Screen } from '../../ui/screen';
import { colors, radius, space } from '../../ui/theme';
import { GpsIndicator, TopUpCard } from '../../ui/widgets';

const NO_RIDES: DriverRide[] = [];

class LocationUnavailable extends Error {
  constructor(readonly reason: 'denied' | 'services_off') {
    super(reason);
  }
}

function explainLocation(reason: 'denied' | 'services_off'): void {
  if (reason === 'services_off') {
    Alert.alert(
      'Joylashuv o‘chiq',
      'Telefoningizda joylashuvni (GPS) yoqing: buyurtmalar sizga eng yaqin haydovchi sifatida beriladi.',
    );
    return;
  }
  Alert.alert(
    'Joylashuvga ruxsat kerak',
    'Liniyaga chiqish uchun ilovaga joylashuvdan foydalanishga ruxsat bering.',
    [
      { text: 'Bekor qilish', style: 'cancel' },
      { text: 'Sozlamalarni ochish', onPress: () => void Linking.openSettings() },
    ],
  );
}

/** Home: the big online/offline switch, what stops the driver from working, today's money. */
export default function Home() {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useDriverMe();
  const ride = useCurrentRide();
  const today = useEarnings('day');
  const mode = useTrackingMode();
  const push = usePushPermission();
  const config = useDriverConfig();
  const optimised = useBatteryOptimization(me.data?.isOnline ?? false);

  const shift = useMutation({
    mutationFn: async (goOnline: boolean): Promise<DriverMe> => {
      if (goOnline) {
        const permission = await ensureLocationPermission();
        if (permission !== 'granted') throw new LocationUnavailable(permission);
        try {
          // dispatch needs a fresh fix to offer anything
          await sendCurrentPosition();
        } catch (error) {
          if (error instanceof ApiError && error.status !== 0) throw error;
        }
      }
      // going on or off shift twice is harmless: a lost answer is simply sent again
      return withRetry(() => driver.shift(goOnline), { attempts: 3, baseMs: 1_000, maxMs: 4_000 });
    },
    onSuccess: (next) => {
      haptics.tap();
      qc.setQueryData(keys.me, next);
      void qc.invalidateQueries({ queryKey: keys.offers });
    },
    onError: (error) => {
      haptics.error();
      if (error instanceof LocationUnavailable) return explainLocation(error.reason);
      // a low balance is explained on the page itself (top-up card)
      if (!isApiError(error, 403)) Alert.alert('Liniya holati o‘zgarmadi', errorMessage(error));
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });

  if (!me.data) {
    return me.isError ? (
      <Screen>
        <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} />
      </Screen>
    ) : (
      <Loading />
    );
  }
  const d = me.data;
  const online = d.isOnline;
  const money = balanceStatus(d.balance, d.minBalance);
  const promo = promoStatus(tashkentToday(), config.billing);
  const current = ride.data ?? null;
  // the current ride could not be loaded: unknown is not "no ride" (ride.tsx does the same)
  const rideUnknown = ride.isError && ride.data === undefined;
  // the balance is explained by its own card; the others are listed as they come
  const blockers = d.blockers.filter((b) => !/balans/i.test(b));
  const canGoOnline = money.canWork && blockers.length === 0;
  const shiftRefused =
    shift.error && isApiError(shift.error, 403) ? errorMessage(shift.error) : null;

  const toggle = () => {
    if (online && rideUnknown) {
      Alert.alert(
        'Safar holati noma’lum',
        'Faol buyurtmangiz bor-yo‘qligini tekshirib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.',
      );
      void ride.refetch();
      return;
    }
    if (online && current) {
      Alert.alert('Avval safarni yakunlang', 'Safar davomida liniyadan chiqib bo‘lmaydi.');
      return;
    }
    if (online) {
      Alert.alert('Liniyadan chiqasizmi?', 'Yangi buyurtmalar kelmaydi.', [
        { text: 'Qolish', style: 'cancel' },
        { text: 'Chiqish', style: 'destructive', onPress: () => shift.mutate(false) },
      ]);
      return;
    }
    shift.mutate(true);
  };

  return (
    <Screen
      refreshing={me.isRefetching}
      onRefresh={() => {
        void me.refetch();
        void ride.refetch();
        void today.refetch();
      }}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {d.fullName.split(' ')[1] ?? d.fullName}
          </Text>
          {d.vehicle ? (
            <Text style={styles.car}>
              {d.vehicle.make} {d.vehicle.model} · {d.vehicle.plateFormatted}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.navigate('/priority')}
          accessibilityRole="button"
          accessibilityLabel={`Ustuvorlik ${d.priority.score}`}
          style={styles.score}
        >
          <Text style={styles.scoreValue} maxFontSizeMultiplier={1.1}>
            {d.priority.score}
          </Text>
          <Text style={styles.scoreLabel} maxFontSizeMultiplier={1.1}>
            reyting
          </Text>
        </Pressable>
      </View>

      {/* the rides in hand: the next stop's ride and, when shared, every stop ahead */}
      {rideUnknown ? (
        <Banner
          tone="warning"
          icon="cloud-offline"
          title="Joriy safar yuklanmadi"
          text={errorMessage(ride.error)}
          action={
            <Button
              title="Qayta urinish"
              icon="refresh"
              variant="secondary"
              onPress={() => void ride.refetch()}
            />
          }
        />
      ) : null}
      <CurrentRideCard rides={current ? [current] : NO_RIDES} />

      <Pressable
        onPress={toggle}
        disabled={shift.isPending || (!online && !canGoOnline)}
        accessibilityRole="switch"
        accessibilityState={{ checked: online, busy: shift.isPending }}
        accessibilityLabel={online ? 'Liniyadasiz. Chiqish uchun bosing' : 'Liniyaga chiqish'}
        style={({ pressed }) => [
          styles.switch,
          online ? styles.switchOn : styles.switchOff,
          !online && !canGoOnline && { opacity: 0.4 },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ionicons
          name={online ? 'radio' : 'power'}
          size={56}
          color={online ? colors.onSuccess : colors.onBrand}
        />
        <Text
          style={[styles.switchText, { color: online ? colors.onSuccess : colors.onBrand }]}
          maxFontSizeMultiplier={1.4}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          {shift.isPending ? 'Kuting…' : online ? 'LINIYADASIZ' : 'LINIYAGA CHIQISH'}
        </Text>
        <Text style={[styles.switchSub, { color: online ? colors.onSuccess : colors.onBrand }]}>
          {online
            ? current
              ? 'Safar davom etmoqda'
              : 'Buyurtma kutilmoqda · chiqish uchun bosing'
            : 'Bosing va buyurtmalar kela boshlaydi'}
        </Text>
      </Pressable>

      {online ? <GpsIndicator /> : null}

      {/* shared rides, people in the car, the heading filter (hidden on an older API; a cargo
          car carries loads, not passengers) */}
      {isCargoCar(d) ? null : <PoolPanel me={d} />}

      {online && mode === 'foreground' ? (
        <Banner
          tone="warning"
          icon="location"
          title="Ilova yopilganda ham ishlasin"
          text="Joylashuvga “Har doim” ruxsat bering: navigator ochiq yoki ekran o‘chiq bo‘lsa ham buyurtmalar keladi."
          action={
            <Button
              title="Ruxsat"
              variant="secondary"
              onPress={() =>
                void requestBackgroundPermission().then(async (ok) => {
                  if (ok) await restartTracking();
                  else await Linking.openSettings();
                })
              }
            />
          }
        />
      ) : null}

      {optimised ? (
        <Banner
          tone="warning"
          icon="battery-half"
          title="Batareya tejash yoqilgan"
          text="Telefon ilovani fonda to‘xtatib qo‘yishi mumkin — buyurtmalar kelmay qoladi. Sozlamalarda “Batareya” → “Cheklovsiz” ni tanlang."
          action={
            <Button
              title="Ochish"
              variant="secondary"
              onPress={() => void Linking.openSettings()}
            />
          }
        />
      ) : null}

      {push.permission === 'denied' || push.permission === 'blocked' ? (
        <Banner
          tone="danger"
          icon="notifications-off"
          title="Bildirishnomalar o‘chiq"
          text="Ilova fonda bo‘lganda buyurtmalarni eshitmaysiz."
          action={
            <Button
              title="Yoqish"
              variant="secondary"
              onPress={() =>
                push.permission === 'blocked'
                  ? void Linking.openSettings()
                  : void requestPushPermission().then((ok) => {
                      if (ok) void registerPushDevice();
                      void push.refresh();
                    })
              }
            />
          }
        />
      ) : null}

      {blockers.map((b) => (
        <Banner key={b} tone="danger" icon="alert-circle" text={b} />
      ))}
      {shiftRefused && money.canWork ? (
        <Banner tone="danger" icon="alert-circle" text={shiftRefused} />
      ) : null}

      {!money.canWork ? (
        <TopUpCard shortBy={money.shortBy} />
      ) : money.level === 'low' ? (
        <Banner
          tone="warning"
          icon="wallet"
          text={`Balans kam: ${som(d.balance)}. ${som(d.minBalance)}dan pastga tushsa, buyurtmalar kelmaydi.`}
          action={
            <Button
              title="To‘ldirish"
              variant="secondary"
              onPress={() => router.navigate('/money')}
            />
          }
        />
      ) : null}

      <Banner tone={promo.active ? 'success' : 'info'} icon="pricetag" text={promo.text} />

      <Card>
        <Title>Bugun</Title>
        {/* not loaded yet (or failed): a dash, never a "0 so'm" that looks real */}
        <Row label="Safarlar" value={today.data ? String(today.data.rides) : '—'} />
        <Row label="Yo‘lovchilardan" value={today.data ? som(today.data.fares) : '—'} />
        <Row label="Komissiya" value={today.data ? som(-today.data.commission) : '—'} />
        <Row
          label={`Soliq (${config.billing.taxPercent}%)`}
          value={today.data ? som(-today.data.tax) : '—'}
        />
        <Row
          label="Sof daromad"
          value={today.data ? som(today.data.net) : '—'}
          strong
          tone="success"
        />
        {today.isError && !today.data ? (
          <Button
            title="Daromadni qayta yuklash"
            icon="refresh"
            variant="secondary"
            onPress={() => void today.refetch()}
          />
        ) : null}
        <Row
          label="Balans"
          value={som(d.balance)}
          tone={money.level === 'ok' ? undefined : 'warning'}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  hello: { fontSize: 26, fontWeight: '900', color: colors.text },
  car: { fontSize: 15, color: colors.muted, marginTop: 2 },
  score: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue: { fontSize: 24, fontWeight: '900', color: colors.brand },
  scoreLabel: { fontSize: 11, color: colors.muted, fontWeight: '700', marginTop: -2 },
  switch: {
    minHeight: 190,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.lg,
  },
  switchOff: { backgroundColor: colors.brand },
  switchOn: { backgroundColor: colors.success },
  switchText: { fontSize: 28, fontWeight: '900', letterSpacing: 1 },
  switchSub: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
});
