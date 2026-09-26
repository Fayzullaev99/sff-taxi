import * as SecureStore from 'expo-secure-store';

/** Keychain / Keystore backed storage for secrets (session tokens). */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string | null): Promise<void> {
    try {
      if (value === null) await SecureStore.deleteItemAsync(key);
      else await SecureStore.setItemAsync(key, value);
    } catch {
      // unavailable keystore: the session lives until the app is closed
    }
  },
};
