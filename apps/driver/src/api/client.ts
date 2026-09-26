import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../config';
import { createApiClient, type Tokens, type TokenStore } from '../lib/api-client';
import { ServerClock } from '../lib/countdown';

const TOKENS_KEY = 'sff.taxi.driver.tokens';

const secureTokenStore: TokenStore = {
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(TOKENS_KEY);
      if (!raw) return null;
      const t = JSON.parse(raw) as Partial<Tokens>;
      return typeof t.accessToken === 'string' && typeof t.refreshToken === 'string'
        ? {
            accessToken: t.accessToken,
            refreshToken: t.refreshToken,
            accessExpiresAt: Number(t.accessExpiresAt) || 0,
          }
        : null;
    } catch {
      return null;
    }
  },
  async save(tokens) {
    // readable in the background too, so the location task can report while the phone is locked
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKENS_KEY);
  },
};

type Listener = () => void;
const expiredListeners = new Set<Listener>();

/** Subscribe to "the refresh token was rejected: sign in again". */
export function onSessionExpired(listener: Listener): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

/** The server's clock as seen from this phone: offer countdowns run on it. */
export const serverClock = new ServerClock();

export const api = createApiClient({
  baseUrl: API_URL,
  store: secureTokenStore,
  onSessionExpired: () => expiredListeners.forEach((l) => l()),
  onServerTime: (serverMs, localMs) => serverClock.observe(serverMs, localMs),
});
