import { useNetInfo } from '@react-native-community/netinfo';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { endpoints } from '../api/endpoints';
import { isOnline, subscribeOnline } from '../api/reachability';
import { offlineMessage, SHOW_AFTER_MS } from './offline-message';
import { Icon, T } from './primitives';
import { colors, space } from './theme';

/** Probes soon after the link dropped, then less often (3G drops are often short). */
const PROBE_MS = [2_000, 4_000, 8_000];

/** Whether the API answered the last request (re-renders when that changes). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, isOnline);
}

/**
 * The API has not answered for a few seconds: one slow answer on 3G does not flash a
 * strip. Meanwhile a tiny health request checks every few seconds, so it clears even when
 * no screen is fetching.
 */
function useOfflineShown(): boolean {
  const online = useOnline();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (online) {
      setShown(false);
      return;
    }
    const show = setTimeout(() => setShown(true), SHOW_AFTER_MS);
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
      clearTimeout(show);
    };
  }, [online]);

  return shown;
}

/**
 * Wraps every screen. While the API cannot be reached a strip sits at the top IN the
 * layout (not over it): the screens move down under it, so no header, button or logo is
 * covered, and they get a top inset of 0 because the strip already covers the status bar.
 * It says whether the phone has no internet or our server does not answer.
 */
export function OfflineFrame({ children }: { children: ReactNode }) {
  const shown = useOfflineShown();
  const insets = useSafeAreaInsets();
  const net = useNetInfo();
  const message = offlineMessage({
    isConnected: net.isConnected,
    isInternetReachable: net.isInternetReachable,
  });

  return (
    <View style={styles.frame}>
      {shown ? (
        <View
          style={[styles.banner, { paddingTop: insets.top + space(1) }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {/* the clock and signal icons stay readable on the dark strip */}
          <StatusBar style="light" />
          <Icon name={message.icon} size={18} color={colors.onInk} />
          <T variant="smallStrong" color={colors.onInk} style={styles.text} numberOfLines={2}>
            {message.text}
          </T>
        </View>
      ) : null}
      <SafeAreaInsetsContext.Provider value={shown ? { ...insets, top: 0 } : insets}>
        {children}
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(4),
    paddingBottom: space(2),
    backgroundColor: colors.ink,
  },
  text: { flex: 1 },
});
