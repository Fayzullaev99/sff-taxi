import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { driver } from '../api/driver';
import type { PreferencesBody } from '../api/types';
import { keys } from '../data/queries';
import { withRetry } from '../lib/ride-actions';
import { type Destination, parseRecent, pushRecent } from '../lib/pool';
import { haptics } from '../ui/haptics';

/**
 * `PUT /v1/driver/preferences`: the answer is the driver profile, which replaces the cached
 * one at once (the pool panel redraws from it). Setting the same values twice is harmless,
 * so a lost answer is simply sent again.
 */
export function usePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PreferencesBody) =>
      withRetry(() => driver.preferences(body), { attempts: 3, baseMs: 1_000, maxMs: 4_000 }),
    onSuccess: (me) => {
      haptics.tap();
      qc.setQueryData(keys.me, me);
    },
    onError: () => {
      haptics.error();
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

const RECENT_KEY = 'sff.taxi.driver.recentDestinations';

export async function loadRecentDestinations(): Promise<Destination[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    return parseRecent(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export async function rememberDestination(d: Destination): Promise<void> {
  try {
    const list = pushRecent(await loadRecentDestinations(), d);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // a convenience only
  }
}
