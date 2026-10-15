import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatDistance, formatMinutes } from '../lib/format';
import type { TripPoint } from '../trip/draft';
import { MAX_STOPS, removeStop, updateDraft } from '../trip/draft';
import { Button, Card, Icon, IconButton, T, TextField } from '../ui/primitives';
import { colors, space } from '../ui/theme';

/**
 * The order sheet's route: the pickup (back to the map to move it) with the landmark
 * right under it, the intermediate stops (up to two: "Oraliq manzil"), the destination
 * (back to the search), the road distance and time.
 */
export function RouteCard({
  pickup,
  dropoff,
  landmark,
  distanceM,
  durationS,
  landmarkPlaceholder = 'Mo‘ljal: 5-maktab ro‘parasi',
  stops = [],
  canAddStop = false,
}: {
  pickup: TripPoint;
  dropoff: TripPoint;
  landmark: string;
  distanceM?: number;
  durationS?: number | null;
  landmarkPlaceholder?: string;
  /** Intermediate stops in order (taxi and delivery; never a shared ride). */
  stops?: readonly TripPoint[];
  /** Whether another stop may be added here. */
  canAddStop?: boolean;
}) {
  return (
    <Card style={styles.route}>
      <RoutePoint
        color={colors.brand}
        label="QAYERDAN"
        spoken="Qayerdan"
        text={pickup.address ?? 'Xaritadagi pin'}
        onPress={() => router.dismissTo('/home')}
      />
      <TextField
        placeholder={landmarkPlaceholder}
        accessibilityLabel="Mo‘ljal, haydovchi uchun"
        value={landmark}
        onChangeText={(value) => updateDraft({ landmark: value })}
        maxLength={200}
        returnKeyType="done"
        style={styles.landmark}
      />
      {stops.map((stop, i) => (
        <View key={i}>
          <View style={styles.routeLine} />
          <View style={styles.stopRow}>
            <View style={styles.flex}>
              <RoutePoint
                color={colors.info}
                label={`ORALIQ MANZIL ${i + 1}`}
                spoken={`${i + 1}-oraliq manzil`}
                text={stop.address ?? 'Xaritadagi pin'}
                onPress={() =>
                  router.push({ pathname: '/search', params: { field: 'stop', index: String(i) } })
                }
              />
            </View>
            <IconButton
              name="close-circle"
              label={`${i + 1}-oraliq manzilni olib tashlash`}
              size={44}
              color={colors.textMuted}
              background="transparent"
              onPress={() => removeStop(i)}
            />
          </View>
        </View>
      ))}
      <View style={styles.routeLine} />
      <RoutePoint
        color={colors.ink}
        label="QAYERGA"
        spoken="Qayerga"
        text={dropoff.address ?? 'Xaritadagi pin'}
        onPress={() => router.replace({ pathname: '/search', params: { field: 'dropoff' } })}
      />
      {canAddStop && stops.length < MAX_STOPS ? (
        <View style={styles.addStop}>
          <Button
            title="Oraliq manzil qo‘shish"
            size="sm"
            variant="ghost"
            icon="add-circle-outline"
            onPress={() =>
              router.push({
                pathname: '/search',
                params: { field: 'stop', index: String(stops.length) },
              })
            }
          />
        </View>
      ) : null}
      {distanceM ? (
        <T variant="small" color={colors.textMuted} style={styles.routeMeta}>
          {formatDistance(distanceM)}
          {durationS ? ` · yo‘lda ~${formatMinutes(durationS / 60)}` : ''}
        </T>
      ) : null}
    </Card>
  );
}

function RoutePoint({
  color,
  label,
  spoken,
  text,
  onPress,
}: {
  color: string;
  label: string;
  spoken: string;
  text: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${spoken}: ${text}. O‘zgartirish`}
      onPress={onPress}
      style={({ pressed }) => [styles.routePoint, pressed ? styles.pressed : null]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.flex}>
        <T variant="caption" color={colors.textMuted}>
          {label}
        </T>
        <T variant="bodyStrong" numberOfLines={2}>
          {text}
        </T>
      </View>
      <Icon name="create-outline" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  route: { gap: 0, paddingVertical: space(2) },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2),
    minHeight: 52,
  },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  routeLine: { width: 2, height: 14, backgroundColor: colors.border, marginLeft: 5 },
  routeMeta: { marginTop: space(1) },
  landmark: { marginLeft: space(6), marginTop: space(1) },
  addStop: { alignItems: 'flex-start', marginLeft: space(4) },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.ink },
});
