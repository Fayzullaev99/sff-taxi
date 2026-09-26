import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { Icon } from './primitives';
import { colors } from './theme';

const SIZE = 150;

/**
 * Rings spreading from a taxi icon while a driver is searched for. Two native-driver
 * loops (transform + opacity only), cheap on low-end Android; still when the phone asks
 * for reduced motion.
 */
export function SearchPulse() {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loops: Animated.CompositeAnimation[] = [];
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled || reduce) return;
        const ring = (v: Animated.Value, delay: number) =>
          Animated.loop(
            Animated.sequence([
              Animated.delay(delay),
              Animated.timing(v, {
                toValue: 1,
                duration: 1800,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
            ]),
          );
        loops = [ring(a, 0), ring(b, 900)];
        loops.forEach((l) => l.start());
      });
    return () => {
      cancelled = true;
      loops.forEach((l) => l.stop());
    };
  }, [a, b]);

  const ringStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
  });

  return (
    <View style={styles.wrap} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.ring, ringStyle(a)]} />
      <Animated.View style={[styles.ring, ringStyle(b)]} />
      <View style={styles.core}>
        <Icon name="car-sport" size={30} color={colors.ink} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.brand,
  },
  core: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
});
