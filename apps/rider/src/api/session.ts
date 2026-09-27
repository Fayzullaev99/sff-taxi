import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { secureStorage } from '../lib/secure-storage';
import { createApiClient, type SessionTokens, type TokenStore } from './client';
import { whenForeground } from './foreground';
import { setOnline } from './reachability';

/** Default: the host machine as seen from the Android emulator. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3200').replace(
  /\/+$/,
  '',
);

const SESSION_KEY = 'sff-taxi.session';

type SessionStatus = 'loading' | 'signedIn' | 'signedOut';

let tokens: SessionTokens | null = null;
let status: SessionStatus = 'loading';
const listeners = new Set<() => void>();
const signOutListeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Writes to secure storage one after another, so an older pair never lands last. */
let writes: Promise<void> = Promise.resolve();

/** In-memory tokens for the API client, written through to secure storage. */
const tokenStore: TokenStore = {
  get: () => tokens,
  set(next) {
    tokens = next;
    status = next ? 'signedIn' : 'signedOut';
    const value = next ? JSON.stringify(next) : null;
    writes = writes.then(() => secureStorage.set(SESSION_KEY, value));
    emit();
    return writes;
  },
};

export const api = createApiClient({
  baseUrl: API_URL,
  tokens: tokenStore,
  onSignedOut: () => {
    for (const l of signOutListeners) l();
  },
  onReachability: setOnline,
  // never rotate the refresh token while the app is in the background: the OS may cut the
  // request off after the server rotated it, and the next try would be a "reuse"
  refreshGate: () => whenForeground(AppState),
});

/** Reads the saved session once at start-up. */
export async function hydrateSession(): Promise<void> {
  if (status !== 'loading') return;
  const raw = await secureStorage.get(SESSION_KEY);
  try {
    const saved = raw ? (JSON.parse(raw) as SessionTokens) : null;
    tokens =
      saved && typeof saved.accessToken === 'string' && typeof saved.refreshToken === 'string'
        ? saved
        : null;
  } catch {
    tokens = null;
  }
  status = tokens ? 'signedIn' : 'signedOut';
  emit();
}

export function setSession(next: SessionTokens | null): void {
  tokenStore.set(next);
}

export function getSessionStatus(): SessionStatus {
  return status;
}

/** Called when the API ends the session (refresh token rejected). */
export function onSignedOut(listener: () => void): () => void {
  signOutListeners.add(listener);
  return () => signOutListeners.delete(listener);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSessionStatus(): SessionStatus {
  return useSyncExternalStore(subscribe, getSessionStatus, getSessionStatus);
}

export function useIsSignedIn(): boolean {
  return useSessionStatus() === 'signedIn';
}

const beforeSignOutHooks = new Set<() => Promise<void>>();

/**
 * Work that needs the session one last time before a deliberate sign-out, e.g. removing
 * this device's push token. Each hook gets a few seconds; failures are ignored.
 */
export function beforeSignOut(hook: () => Promise<void>): () => void {
  beforeSignOutHooks.add(hook);
  return () => beforeSignOutHooks.delete(hook);
}

const HOOK_TIMEOUT_MS = 4000;

/** Revokes the session on the server (best effort) and forgets it locally. */
export async function signOut(): Promise<void> {
  if (tokens && beforeSignOutHooks.size) {
    await Promise.all(
      [...beforeSignOutHooks].map((hook) =>
        Promise.race([
          hook().catch(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, HOOK_TIMEOUT_MS)),
        ]),
      ),
    );
  }
  // a refresh in flight would leave the logout below with a dead token
  await api.settled();
  const current = tokens;
  tokenStore.set(null);
  for (const l of signOutListeners) l();
  if (!current) return;
  try {
    await api.request('/v1/auth/logout', {
      method: 'POST',
      auth: 'none',
      body: { refreshToken: current.refreshToken },
    });
  } catch {
    // offline: the refresh token expires on its own
  }
}
