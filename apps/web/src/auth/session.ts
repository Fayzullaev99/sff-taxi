import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { api, sessionStore } from '../api/client';
import type { Me } from '../api/types';

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    // another tab signed in or out
    if (e.key === 'taxi.session') onChange();
  };
  window.addEventListener('taxi:session', onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('taxi:session', onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Whether a session exists; changes when signing in/out here or in another tab. */
export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, () => sessionStore.get() !== null);
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/v1/me'),
    enabled,
    staleTime: 60_000,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    const session = sessionStore.get();
    if (session) {
      // best effort: revoke the refresh token; sign out locally regardless
      await api('/v1/auth/logout', {
        method: 'POST',
        auth: false,
        body: { refreshToken: session.refreshToken },
      }).catch(() => undefined);
    }
    sessionStore.set(null);
    queryClient.clear();
  }, [queryClient]);
}
