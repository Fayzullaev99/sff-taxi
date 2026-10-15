import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const KEY = 'sff-taxi.install-id';
let cached: Promise<string | null> | null = null;

/**
 * This install's own random id (not a hardware id): the invitation programme sends it so a
 * phone can accept one invitation, and a referrer cannot invite themselves from another SIM
 * card on the same phone. Made once and kept; null if storage is unavailable.
 */
export function installId(): Promise<string | null> {
  cached ??= (async () => {
    try {
      const saved = await AsyncStorage.getItem(KEY);
      if (saved) return saved;
      const id = `rd-${Crypto.randomUUID()}`;
      await AsyncStorage.setItem(KEY, id);
      return id;
    } catch {
      return null;
    }
  })();
  return cached;
}
