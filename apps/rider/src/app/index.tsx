import { Redirect } from 'expo-router';
import { useSessionStatus } from '../api/session';

/** Ordering needs an account (quotes are per rider): sign in first, then the map. */
export default function Index() {
  const status = useSessionStatus();
  if (status === 'loading') return null;
  return <Redirect href={status === 'signedIn' ? '/home' : '/sign-in'} />;
}
