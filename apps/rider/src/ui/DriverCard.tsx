import { StyleSheet, View } from 'react-native';
import type { RideDriver, RideVehicle } from '../api/types';
import { callPhone } from '../lib/links';
import { IconButton, T } from './primitives';
import { formatRating, RatingBadge } from './Rating';
import { colors, radius, space } from './theme';

/**
 * Which car to look for: the plate large, like the real plate (white, black frame), the
 * colour and model in words, the driver's name and rating, and a call button.
 */
export function DriverCard({
  driver,
  vehicle,
}: {
  driver: RideDriver | null;
  vehicle: RideVehicle | null;
}) {
  return (
    <View style={styles.root}>
      {vehicle ? (
        <View style={styles.carRow}>
          <View
            style={styles.plate}
            accessible
            accessibilityLabel={`Davlat raqami ${vehicle.plateFormatted.split('').join(' ')}`}
          >
            <T variant="plate" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {vehicle.plateFormatted}
            </T>
          </View>
          <View style={styles.flex}>
            <T variant="h3" numberOfLines={2}>
              {capitalise(vehicle.colour)} {vehicle.make} {vehicle.model}
            </T>
          </View>
        </View>
      ) : null}
      {driver ? (
        <View style={styles.driverRow}>
          <View style={styles.avatar} importantForAccessibility="no">
            <T variant="h3">{driver.name.trim().charAt(0).toUpperCase() || '?'}</T>
          </View>
          <View
            style={styles.flex}
            accessible
            accessibilityLabel={`Haydovchi ${driver.name}, reyting ${formatRating(driver.rating)}, ${driver.ridesCompleted} ta safar`}
          >
            <T variant="bodyStrong" numberOfLines={1}>
              {driver.name}
            </T>
            <View style={styles.meta}>
              <RatingBadge rating={driver.rating} />
              <T variant="small" color={colors.textMuted} numberOfLines={1}>
                · {driver.ridesCompleted} ta safar
              </T>
            </View>
          </View>
          <IconButton
            name="call"
            label={`Haydovchiga qo‘ng‘iroq qilish: ${driver.name}`}
            size={52}
            color={colors.ink}
            background={colors.brand}
            onPress={() => void callPhone(driver.phone)}
          />
        </View>
      ) : null}
    </View>
  );
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const styles = StyleSheet.create({
  root: { gap: space(3) },
  flex: { flex: 1, minWidth: 0 },
  carRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  plate: {
    borderWidth: 2.5,
    borderColor: colors.ink,
    borderRadius: radius.sm,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
    backgroundColor: colors.bg,
    maxWidth: '60%',
  },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
});
