import * as Battery from 'expo-battery';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

/**
 * Whether Android's battery optimisation is on for this app. Many cheap phones (Xiaomi,
 * Tecno, Samsung's "sleeping apps") then stop the location service after a while, and the
 * driver silently drops out of dispatch. Re-read when the driver returns from the settings.
 */
export function useBatteryOptimization(enabled: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') return;
    let alive = true;
    const read = () =>
      void Battery.isBatteryOptimizationEnabledAsync()
        .then((v) => alive && setOn(v))
        .catch(() => undefined);
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => {
      alive = false;
      sub.remove();
    };
  }, [enabled]);
  return enabled && on;
}
