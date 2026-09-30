/**
 * What the offline strip says. The strip shows when OUR API does not answer; the phone's
 * own connection tells whether that is the phone's internet or the server. Framework-free
 * so it is unit-tested in plain Node.
 */

/** The API must stay silent this long before the strip shows (one slow 3G answer is not "offline"). */
export const SHOW_AFTER_MS = 3_000;

export interface NetState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export function offlineMessage(net: NetState): {
  icon: 'cloud-offline-outline' | 'server-outline';
  text: string;
} {
  // null = not known yet: only a definite "no" blames the phone's internet
  if (net.isConnected === false || net.isInternetReachable === false) {
    return { icon: 'cloud-offline-outline', text: 'Internet aloqasi yo‘q. Qayta ulanmoqda…' };
  }
  return {
    icon: 'server-outline',
    text: 'Server bilan aloqa yo‘q. Qayta ulanmoqda…',
  };
}
