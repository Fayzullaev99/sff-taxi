import { router, useGlobalSearchParams, useSegments } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dismissRideNotice, getRideNotice, subscribeRideNotice } from '../trip/shown-rides';
import { Icon, T } from './primitives';
import { colors, radius, space } from './theme';

/** How long the notice stays up untouched. */
const SHOW_MS = 12_000;

/** A header's height under the status bar: the notice sits below it (the back button works). */
const HEADER = 56;

/**
 * A notice over the screens that an open ride needs the rider ("Oldindan buyurtmangiz uchun
 * haydovchi qidirilmoqda"), shown instead of taking the screen away mid-order; a tap opens
 * the ride. It goes away by itself, on the ride's screen, or with the ×.
 */
export function RideNoticeBanner() {
  const notice = useSyncExternalStore(subscribeRideNotice, getRideNotice, getRideNotice);
  const insets = useSafeAreaInsets();
  const segments = useSegments() as string[];
  const params = useGlobalSearchParams<{ id?: string }>();
  const onItsRide = segments[0] === 'ride' && params.id === notice?.rideId;

  useEffect(() => {
    if (!notice) return;
    if (onItsRide) {
      dismissRideNotice();
      return;
    }
    const t = setTimeout(dismissRideNotice, SHOW_MS);
    return () => clearTimeout(t);
  }, [notice, onItsRide]);

  if (!notice || onItsRide) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={notice.text + '. Ochish'}
      accessibilityLiveRegion="polite"
      onPress={() => {
        dismissRideNotice();
        router.push({ pathname: '/ride/[id]', params: { id: notice.rideId } });
      }}
      style={({ pressed }) => [
        styles.card,
        { top: insets.top + HEADER },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <Icon name="car" size={20} color={colors.onInk} />
      <T variant="smallStrong" color={colors.onInk} style={styles.text}>
        {notice.text}
      </T>
      <T variant="smallStrong" color={colors.brand}>
        Ochish
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Yopish"
        hitSlop={12}
        onPress={dismissRideNotice}
      >
        <Icon name="close" size={20} color={colors.onInk} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: space(3),
    right: space(3),
    zIndex: 90,
    elevation: 90,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  text: { flex: 1 },
});
