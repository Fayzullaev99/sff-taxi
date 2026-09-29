import { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { endpoints } from '../api/endpoints';
import { isOnline, subscribeOnline } from '../api/reachability';
import { Icon, T } from './primitives';
import { colors, space } from './theme';

/** Probes soon after the link dropped, then less often (3G drops are often short). */
const PROBE_MS = [2_000, 4_000, 8_000];

/**
 * A strip over every screen while the API cannot be reached. It appears after a request
 * got no answer and goes away with the next answer; meanwhile a tiny health request
 * checks every few seconds, so it clears even when no screen is fetching.
 */
/** Whether the API answered the last request (re-renders when that changes). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, isOnline);
}

export function OfflineBanner() {
  const online = useOnline();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (online) return;
    let n = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const probe = () => {
      timer = setTimeout(
        () => {
          n++;
          endpoints
            .health()
            .catch(() => undefined)
            .finally(() => {
              if (!stopped && !isOnline()) probe();
            });
        },
        PROBE_MS[Math.min(n, PROBE_MS.length - 1)],
      );
    };
    probe();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [online]);

  if (online) return null;
  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + space(1) }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Icon name="cloud-offline-outline" size={18} color={colors.onInk} />
      <T variant="smallStrong" color={colors.onInk} style={styles.text}>
        Internet aloqasi yo‘q. Qayta ulanmoqda…
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(4),
    paddingBottom: space(2),
    backgroundColor: colors.ink,
  },
  text: { flex: 1 },
});
