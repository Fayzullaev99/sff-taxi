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
import { t, useT } from '../../i18n';
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
    Alert.alert(t('home.shift.locationOffTitle'), t('home.shift.locationOffText'));
    return;
  }
  Alert.alert(t('home.shift.permissionTitle'), t('home.shift.permissionText'), [
    { text: t('common.actions.cancel'), style: 'cancel' },
    { text: t('common.actions.openSettings'), onPress: () => void Linking.openSettings() },
  ]);
}

/** The API's blocker about the balance (Uzbek or Russian): the top-up card explains it. */
const ABOUT_BALANCE = /balans|баланс/i;

/** Home: the big online/offline switch, what stops the driver from working, today's money. */
export default function Home() {
  const { t } = useT();
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
      if (!isApiError(error, 403))
        Alert.alert(t('home.shift.notChangedTitle'), errorMessage(error));
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
  const blockers = d.blockers.filter((b) => !ABOUT_BALANCE.test(b));
  const canGoOnline = money.canWork && blockers.length === 0;
  const shiftRefused =
    shift.error && isApiError(shift.error, 403) ? errorMessage(shift.error) : null;

  const toggle = () => {
    if (online && rideUnknown) {
      Alert.alert(t('home.shift.rideUnknownTitle'), t('home.shift.rideUnknownText'));
      void ride.refetch();
      return;
    }
    if (online && current) {
      Alert.alert(t('home.shift.finishFirstTitle'), t('home.shift.finishFirstText'));
      return;
    }
    if (online) {
      Alert.alert(t('home.shift.goOfflineTitle'), t('home.shift.goOfflineText'), [
        { text: t('home.shift.stay'), style: 'cancel' },
        { text: t('home.shift.leave'), style: 'destructive', onPress: () => shift.mutate(false) },
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
          accessibilityLabel={t('home.shift.priorityA11y', { score: d.priority.score })}
          style={styles.score}
        >
          <Text style={styles.scoreValue} maxFontSizeMultiplier={1.1}>
            {d.priority.score}
          </Text>
          <Text style={styles.scoreLabel} maxFontSizeMultiplier={1.1}>
            {t('home.shift.rating')}
          </Text>
        </Pressable>
      </View>

      {/* the rides in hand: the next stop's ride and, when shared, every stop ahead */}
      {rideUnknown ? (
        <Banner
          tone="warning"
          icon="cloud-offline"
          title={t('home.shift.currentNotLoaded')}
          text={errorMessage(ride.error)}
          action={
            <Button
              title={t('common.actions.retry')}
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
        accessibilityLabel={t(online ? 'home.shift.onlineA11y' : 'home.shift.goOnlineA11y')}
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
          {shift.isPending
            ? t('home.shift.wait')
            : online
              ? t('home.shift.online')
              : t('home.shift.goOnline')}
        </Text>
        <Text style={[styles.switchSub, { color: online ? colors.onSuccess : colors.onBrand }]}>
          {online
            ? current
              ? t('home.shift.rideGoingOn')
              : t('home.shift.waitingForOrder')
            : t('home.shift.tapToStart')}
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
          title={t('home.shift.backgroundTitle')}
          text={t('home.shift.backgroundText')}
          action={
            <Button
              title={t('home.shift.allow')}
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
          title={t('home.battery.title')}
          text={t('home.battery.text')}
          action={
            <Button
              title={t('common.actions.open')}
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
          title={t('home.shift.pushOffTitle')}
          text={t('home.shift.pushOffText')}
          action={
            <Button
              title={t('common.actions.enable')}
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
          text={t('home.shift.lowBalance', { balance: som(d.balance), min: som(d.minBalance) })}
          action={
            <Button
              title={t('home.shift.topUp')}
              variant="secondary"
              onPress={() => router.navigate('/money')}
            />
          }
        />
      ) : null}

      <Banner tone={promo.active ? 'success' : 'info'} icon="pricetag" text={promo.text} />

      <Card>
        <Title>{t('common.time.today')}</Title>
        {/* not loaded yet (or failed): a dash, never a "0 so'm" that looks real */}
        <Row
          label={t('common.screens.rides')}
          value={today.data ? String(today.data.rides) : '—'}
        />
        <Row label={t('home.shift.fromRiders')} value={today.data ? som(today.data.fares) : '—'} />
        <Row
          label={t('common.ledgerKind.commission')}
          value={today.data ? som(-today.data.commission) : '—'}
        />
        <Row
          label={t('home.shift.tax', { percent: config.billing.taxPercent })}
          value={today.data ? som(-today.data.tax) : '—'}
        />
        <Row
          label={t('home.shift.net')}
          value={today.data ? som(today.data.net) : '—'}
          strong
          tone="success"
        />
        {today.isError && !today.data ? (
          <Button
            title={t('home.shift.reloadEarnings')}
            icon="refresh"
            variant="secondary"
            onPress={() => void today.refetch()}
          />
        ) : null}
        <Row
          label={t('home.shift.balance')}
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
