import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PoolCar, Quote, RideClass, SeatLayout } from '../api/types';
import { formatMoney } from '../lib/format';
import {
  clampPassengers,
  poolCarsFor,
  poolCarsHeadline,
  poolCarText,
  routePrices,
  seatMap,
  shareToggleText,
  womenDriversText,
} from '../lib/sharing';
import { updateDraft } from '../trip/draft';
import { Button, Icon, type IconName, Stepper, T } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';
import { PreferenceRow } from './OrderOptions';

export interface ChoicesState {
  passengers: number;
  shareable: boolean;
  womenOnly: boolean;
  fareMode: 'car' | 'seat';
}

/**
 * A fixed price between towns: a seat (per person, in a shared car) or the whole car.
 * Shown only when the route has a seat price for the class (the whole-car price is then
 * the class card's price anyway).
 */
export function RouteModeChoice({
  quote,
  rideClass,
  fareMode,
  carTotal,
}: {
  quote: Quote;
  rideClass: RideClass;
  fareMode: 'car' | 'seat';
  carTotal: number;
}) {
  const prices = routePrices(quote, rideClass);
  const route = quote.route;
  if (!route || !prices) return null;
  return (
    <View style={styles.route}>
      <View style={styles.routeHead}>
        <Icon name="swap-horizontal" size={18} color={colors.ink} />
        <T variant="bodyStrong" style={styles.flex} numberOfLines={2}>
          {route.from.name} → {route.to.name}: belgilangan narx
        </T>
      </View>
      {prices.seat ? (
        <View style={styles.modes} accessibilityRole="radiogroup">
          <ModeCard
            title="O‘rindiq"
            price={`${formatMoney(prices.seat)}/kishi`}
            icon="person-outline"
            selected={fareMode === 'seat'}
            // a seat is a shared ride: cash only
            onPress={() => updateDraft({ fareMode: 'seat', paymentMethod: 'cash' })}
          />
          <ModeCard
            title="Butun mashina"
            price={formatMoney(carTotal)}
            icon="car-outline"
            selected={fareMode === 'car'}
            onPress={() => updateDraft({ fareMode: 'car' })}
          />
        </View>
      ) : null}
      <T variant="small" color={colors.textMuted}>
        {fareMode === 'seat' && prices.seat
          ? 'O‘rindiq narxi: mashina shu yo‘nalishdagi boshqa yo‘lovchilarni ham oladi. Faqat naqd.'
          : 'Butun mashina faqat siz uchun.'}
      </T>
    </View>
  );
}

function ModeCard({
  title,
  price,
  icon,
  selected,
  onPress,
}: {
  title: string;
  price: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}, ${price}`}
      onPress={onPress}
      style={[styles.mode, selected ? styles.modeOn : null]}
    >
      <Icon name={icon} size={20} color={colors.ink} />
      <View style={styles.flex}>
        <T variant="bodyStrong" numberOfLines={1}>
          {title}
        </T>
        <T variant="smallStrong" numberOfLines={2}>
          {price}
        </T>
      </View>
    </Pressable>
  );
}

/** How many people ride: 1–3 (one in front, at most two in the back). */
export function PassengersRow({ quote, passengers }: { quote: Quote; passengers: number }) {
  const max = clampPassengers(99, quote);
  return (
    <View style={styles.people}>
      <View style={styles.flex}>
        <T variant="bodyStrong">Yo‘lovchilar</T>
        <T variant="small" color={colors.textMuted}>
          Ko‘pi bilan {max} kishi: oldinda 1, orqada ko‘pi bilan 2
        </T>
      </View>
      <Stepper
        value={passengers}
        min={1}
        max={max}
        onChange={(n) => updateDraft({ passengers: clampPassengers(n, quote) })}
      />
    </View>
  );
}

/**
 * "Hamroh bilan" and "Ayol haydovchi" rows for the order sheet's preferences. Hidden when
 * the API does not offer them (an older API: no fields).
 */
export function SharingRows({ quote, choices }: { quote: Quote; choices: ChoicesState }) {
  const pool = quote.pool;
  const women = quote.womenOnly;
  const cars = poolCarsFor(pool?.cars, choices.passengers);
  return (
    <>
      {pool?.available && choices.fareMode !== 'seat' ? (
        <PreferenceRow
          label="Hamroh bilan"
          hint={`${shareToggleText(pool.discountPercent)}. Faqat naqd to‘lov.`}
          value={choices.shareable}
          onChange={(on) =>
            updateDraft(on ? { shareable: true, paymentMethod: 'cash' } : { shareable: false })
          }
          extra={<PoolCars cars={cars} passengers={choices.passengers} />}
        />
      ) : null}
      {women ? (
        <PreferenceRow
          label="Ayol haydovchi"
          hint={
            women.available
              ? (womenDriversText(women.drivers) ?? 'Faqat ayol haydovchilar')
              : 'Ayollar uchun. Profilda jinsingizni belgilang.'
          }
          value={women.available && choices.womenOnly}
          disabled={!women.available}
          onChange={(on) => updateDraft({ womenOnly: on })}
        />
      ) : null}
      {women && !women.available ? (
        <View style={styles.profileLink}>
          <Button
            title="Profilda jinsni belgilash"
            size="sm"
            variant="ghost"
            icon="person-circle-outline"
            onPress={() => router.push('/profile')}
          />
        </View>
      ) : null}
    </>
  );
}

/** Cars already going the rider's way, before ordering: who is inside, the free seats. */
const PoolCars = memo(function PoolCars({
  cars,
  passengers,
}: {
  cars: PoolCar[];
  passengers: number;
}) {
  return (
    <View style={styles.cars} accessibilityRole="summary">
      <T variant="smallStrong" color={cars.length ? colors.success : colors.textMuted}>
        {poolCarsHeadline(cars, passengers)}
      </T>
      {cars.map((car, i) => (
        <View key={i} style={styles.car} accessible accessibilityLabel={poolCarText(car)}>
          <SeatIcons car={car} />
          <T variant="small" style={styles.flex} numberOfLines={2}>
            {poolCarText(car)}
          </T>
        </View>
      ))}
    </View>
  );
});

/** A car from above: the driver and the front seat, the back seats; taken ones filled. */
export function SeatIcons({ car }: { car: SeatLayout }) {
  const seats = seatMap(car);
  const front = seats.filter((s) => s.place === 'front');
  const rear = seats.filter((s) => s.place === 'rear');
  return (
    <View style={styles.seatCar} importantForAccessibility="no-hide-descendants">
      <View style={styles.seatRow}>
        <View style={[styles.seat, styles.driverSeat]} />
        {front.map((s, i) => (
          <View key={`f${i}`} style={[styles.seat, s.taken ? styles.taken : null]} />
        ))}
      </View>
      <View style={styles.seatRow}>
        {rear.map((s, i) => (
          <View key={`r${i}`} style={[styles.seat, s.taken ? styles.taken : null]} />
        ))}
      </View>
    </View>
  );
}

const SEAT = 11;

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  route: {
    gap: space(2),
    padding: space(3),
    borderRadius: radius.lg,
    backgroundColor: colors.infoSoft,
  },
  modes: { flexDirection: 'row', gap: space(2) },
  mode: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    padding: space(3),
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  modeOn: { borderColor: colors.ink, backgroundColor: colors.brandSoft },
  routeHead: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  people: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  profileLink: {
    alignItems: 'flex-start',
    paddingHorizontal: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  cars: { gap: space(2) },
  car: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  seatCar: {
    padding: 3,
    gap: 3,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.bg,
  },
  seatRow: { flexDirection: 'row', gap: 3 },
  seat: {
    width: SEAT,
    height: SEAT,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.bg,
  },
  taken: { backgroundColor: colors.ink },
  driverSeat: { backgroundColor: colors.textFaint, borderColor: colors.textFaint },
});
