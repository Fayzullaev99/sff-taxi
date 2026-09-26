import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  type DimensionValue,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { describeError, isOffline } from '../api/client';
import { Button, Icon, type IconName, T } from './primitives';
import { colors, radius, space } from './theme';

export function LoadingView({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.brand} />
      {label ? (
        <T variant="small" color={colors.textMuted}>
          {label}
        </T>
      ) : null}
    </View>
  );
}

export function EmptyView({
  icon,
  title,
  message,
  actionTitle,
  onAction,
}: {
  icon: IconName;
  title: string;
  message?: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.center}>
      <View style={styles.iconCircle}>
        <Icon name={icon} size={34} color={colors.brand} />
      </View>
      <T variant="h3" align="center">
        {title}
      </T>
      {message ? (
        <T variant="body" color={colors.textMuted} align="center" style={styles.message}>
          {message}
        </T>
      ) : null}
      {actionTitle && onAction ? (
        <Button title={actionTitle} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const offline = isOffline(error);
  return (
    <EmptyView
      icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
      title={offline ? 'Aloqa yo‘q' : 'Nimadir xato ketdi'}
      message={describeError(error)}
      actionTitle={onRetry ? 'Qayta urinish' : undefined}
      onAction={onRetry}
    />
  );
}

/** Pulsing placeholder block for loading lists. */
export function Skeleton({
  width = '100%',
  height,
  style,
}: {
  width?: DimensionValue;
  height: number;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius.md, backgroundColor: colors.skeleton, opacity },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(8),
    gap: space(3),
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(1),
  },
  message: { maxWidth: 320 },
  action: { marginTop: space(2), minWidth: 200 },
});
