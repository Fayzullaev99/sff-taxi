import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, onSessionExpired } from '../api/client';
import type { TokenPair } from '../lib/api-client';
import { clearSnapshot } from '../data/persist';
import { stopTracking } from '../location/tracker';
import { unregisterPushDevice } from '../notifications/push';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface Session {
  status: AuthStatus;
  signIn: (pair: TokenPair) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider(props: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let alive = true;
    api
      .hasSession()
      .then((has) => alive && setStatus(has ? 'signedIn' : 'signedOut'))
      .catch(() => alive && setStatus('signedOut'));
    const unsubscribe = onSessionExpired(() => {
      void stopTracking();
      void clearSnapshot();
      queryClient.clear();
      setStatus('signedOut');
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [queryClient]);

  const signIn = useCallback(
    async (pair: TokenPair) => {
      await api.signIn(pair);
      await clearSnapshot();
      queryClient.clear();
      setStatus('signedIn');
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await stopTracking();
    // leave the line so no offers are routed to a signed-out phone
    await api.post('/v1/driver/shift', { online: false }).catch(() => undefined);
    // this phone must stop receiving the account's pushes (needs the session, so first)
    await unregisterPushDevice();
    await api.signOut();
    await clearSnapshot();
    queryClient.clear();
    setStatus('signedOut');
  }, [queryClient]);

  const value = useMemo(() => ({ status, signIn, signOut }), [status, signIn, signOut]);
  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}
