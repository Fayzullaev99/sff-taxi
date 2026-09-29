import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { memo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DriverMe } from '../api/types';
import {
  destinationChip,
  extraPassengersStep,
  FRONT_SEATS,
  poolSettings,
  preferencesError,
  REAR_SEATS_MAX,
  type Seats,
  seatsText,
} from '../lib/pool';
import { Banner, Button, Card, Muted, Title, ToggleRow } from '../ui/components';
import { haptics } from '../ui/haptics';
import { colors, radius, space, TOUCH } from '../ui/theme';
import { usePreferences } from './preferences';

/**
 * Shared rides on home: "Boshqa yo‘lovchi olaman", people riding without the app, where the
 * driver is heading (only rides on the way are offered), and the seats — one in front, never
 * more than two in the back. Hidden on an API without these settings.
 */
export const PoolPanel = memo(function PoolPanel(props: { me: DriverMe }) {
  const router = useRouter();
  const prefs = usePreferences();
  const pool = poolSettings(props.me);
  if (!pool) return null;
  const busy = prefs.isPending;
  const capacity = pool.seats.capacity || 3;

  const chooseDestination = (extra?: number) =>
    router.push(extra !== undefined ? `/destination?extra=${extra}` : '/destination');

  const changeExtra = (delta: number) => {
    const next = extraPassengersStep(
      pool.extraPassengers,
      delta,
      pool.destination !== null,
      capacity,
    );
    if (next.value === pool.extraPassengers) return;
    haptics.select();
    if (next.needsDestination) {
      Alert.alert(
        'Qayerga ketyapsiz?',
        'Mashinada yo‘lovchi bo‘lsa, manzilingizni belgilang: faqat yo‘lingizdagi buyurtmalar keladi.',
        [
          { text: 'Bekor qilish', style: 'cancel' },
          { text: 'Manzilni tanlash', onPress: () => chooseDestination(next.value) },
        ],
      );
      return;
    }
    prefs.mutate({ extraPassengers: next.value });
  };

  const clearDestination = () => {
    if (pool.extraPassengers > 0) {
      Alert.alert(
        'Yo‘nalishni o‘chirasizmi?',
        'Mashinadagi ilovasiz yo‘lovchilar soni ham 0 ga tushadi.',
        [
          { text: 'Yo‘q', style: 'cancel' },
          {
            text: 'O‘chirish',
            style: 'destructive',
            onPress: () => prefs.mutate({ destination: null, extraPassengers: 0 }),
          },
        ],
      );
      return;
    }
    prefs.mutate({ destination: null });
  };

  const chip = destinationChip(pool.destination);
  return (
    <Card>
      <Title>Hamroh yo‘lovchilar</Title>
      <ToggleRow
        label="Boshqa yo‘lovchi olaman"
        description="Yo‘lingizdagi boshqa buyurtmalar ham keladi: daromad ko‘proq, har kim arzonroq to‘laydi."
        value={pool.enabled}
        disabled={busy}
        onChange={(v) => prefs.mutate({ poolEnabled: v })}
      />

      <View style={styles.stepperRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Mashinada nechta odam bor</Text>
          <Muted>Ilovasiz o‘tirganlar (tanishlar, yo‘lda olinganlar)</Muted>
        </View>
        <StepButton
          icon="remove"
          label="Kamaytirish"
          disabled={busy || pool.extraPassengers <= 0}
          onPress={() => changeExtra(-1)}
        />
        <Text style={styles.count} maxFontSizeMultiplier={1.2}>
          {pool.extraPassengers}
        </Text>
        <StepButton
          icon="add"
          label="Ko‘paytirish"
          disabled={busy || pool.extraPassengers >= capacity}
          onPress={() => changeExtra(1)}
        />
      </View>

      <SeatMap seats={pool.seats} />

      {chip ? (
        <View style={styles.chip}>
          <Ionicons name="navigate" size={20} color={colors.onBrand} />
          <Text style={styles.chipText} numberOfLines={2}>
            {chip}
          </Text>
          <Pressable
            onPress={clearDestination}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Yo‘nalishni o‘chirish"
            hitSlop={8}
            style={({ pressed }) => [styles.chipClear, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="close" size={24} color={colors.onBrand} />
          </Pressable>
        </View>
      ) : (
        <Button
          title="Qayerga ketyapsiz?"
          icon="flag"
          variant="secondary"
          disabled={busy}
          onPress={() => chooseDestination()}
          accessibilityHint="Faqat yo‘lingizdagi buyurtmalar keladi"
        />
      )}
      {chip ? (
        <Button
          title="Manzilni o‘zgartirish"
          variant="ghost"
          disabled={busy}
          onPress={() => chooseDestination()}
        />
      ) : null}

      {prefs.error ? (
        <Banner tone="danger" icon="alert-circle" text={preferencesError(prefs.error)} />
      ) : null}
    </Card>
  );
});

function StepButton(props: {
  icon: 'add' | 'remove';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={({ pressed }) => [
        styles.step,
        props.disabled && { opacity: 0.35 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons name={props.icon} size={28} color={colors.text} />
    </Pressable>
  );
}

/** The car from above: the driver and one seat in front, at most two in the back. */
function SeatMap({ seats }: { seats: Seats }) {
  const rearCap = Math.max(0, Math.min(REAR_SEATS_MAX, seats.capacity - FRONT_SEATS));
  const seat = (taken: boolean, key: string) => (
    <View key={key} style={[styles.seat, taken && styles.seatTaken]}>
      <Ionicons name="person" size={22} color={taken ? colors.onBrand : colors.border} />
    </View>
  );
  return (
    <View style={styles.seatRow}>
      <View style={styles.car} accessible accessibilityLabel={`O‘rindiqlar: ${seatsText(seats)}`}>
        <View style={styles.carRow}>
          <View style={[styles.seat, styles.driverSeat]}>
            <Ionicons name="car-sport" size={22} color={colors.muted} />
          </View>
          {seat(seats.front > 0, 'front')}
        </View>
        <View style={styles.carRow}>
          {Array.from({ length: rearCap }, (_, i) => seat(i < seats.rear, `rear${i}`))}
        </View>
      </View>
      <Text style={styles.seatText}>{seatsText(seats)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 16, fontWeight: '800', color: colors.text },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  step: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '900',
    color: colors.brand,
    fontVariant: ['tabular-nums'],
  },
  seatRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  car: {
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },
  carRow: { flexDirection: 'row', gap: space.xs, justifyContent: 'center' },
  seat: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatTaken: { backgroundColor: colors.brand, borderColor: colors.brand },
  driverSeat: { borderStyle: 'dashed' },
  seatText: { flex: 1, color: colors.muted, fontSize: 15, fontWeight: '700' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingLeft: space.md,
    minHeight: TOUCH,
  },
  chipText: { flex: 1, color: colors.onBrand, fontSize: 16, fontWeight: '800' },
  chipClear: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
