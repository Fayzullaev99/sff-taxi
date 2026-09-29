import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatDistance, formatMinutes } from '../lib/format';
import type { TripPoint } from '../trip/draft';
import { updateDraft } from '../trip/draft';
import { Card, Icon, T, TextField } from '../ui/primitives';
import { colors, space } from '../ui/theme';

/**
 * The order sheet's route: the pickup (back to the map to move it) with the landmark
 * right under it, the destination (back to the search), the road distance and time.
 */
export function RouteCard({
  pickup,
  dropoff,
  landmark,
  distanceM,
  durationS,
  landmarkPlaceholder = 'Mo‘ljal: 5-maktab ro‘parasi, yashil darvoza',
}: {
  pickup: TripPoint;
  dropoff: TripPoint;
  landmark: string;
  distanceM?: number;
  durationS?: number | null;
  landmarkPlaceholder?: string;
}) {
  return (
    <Card style={styles.route}>
      <RoutePoint
        color={colors.brand}
        label="QAYERDAN"
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
      <View style={styles.routeLine} />
      <RoutePoint
        color={colors.ink}
        label="QAYERGA"
        text={dropoff.address ?? 'Xaritadagi pin'}
        onPress={() => router.replace({ pathname: '/search', params: { field: 'dropoff' } })}
      />
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
  text,
  onPress,
}: {
  color: string;
  label: string;
  text: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label === 'QAYERDAN' ? 'Qayerdan' : 'Qayerga'}: ${text}. O‘zgartirish`}
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
  routeLine: { width: 2, height: 14, backgroundColor: colors.border, marginLeft: 5 },
  routeMeta: { marginTop: space(1) },
  landmark: { marginLeft: space(6), marginTop: space(1) },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.ink },
});
