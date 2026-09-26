import { Redirect } from 'expo-router';
import { useSession } from '../auth/session';
import { useDriverMe } from '../data/queries';

/** Entry point: sends the driver to wherever their account stands. */
export default function Index() {
  const session = useSession();
  const signedIn = session.status === 'signedIn';
  const me = useDriverMe(signedIn);
  if (!signedIn) return <Redirect href="/sign-in" />;
  if (me.data === null) return <Redirect href="/apply" />;
  return <Redirect href={me.data?.status === 'active' ? '/home' : '/status'} />;
}
