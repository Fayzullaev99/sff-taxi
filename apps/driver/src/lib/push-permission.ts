export type PushPermission = 'granted' | 'undetermined' | 'denied' | 'blocked';

/** What `Notifications.getPermissionsAsync()` reports, reduced to what the app uses. */
export interface PermissionSnapshot {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}

/**
 * The notification permission as the app acts on it (pure, unit-tested).
 *
 * On Android 13+ expo-notifications reports status "denied" (with `canAskAgain: true`) for
 * a permission that was never asked: notifications are simply not enabled yet. Taken at
 * face value, the "why notifications" step never appeared and the system prompt was never
 * shown. Until this phone went through that step (`introSeen`), an askable permission is
 * therefore still `undetermined`; after it, a refusal is `denied` (home offers to allow),
 * and `blocked` once the system will not ask again (only the settings page helps).
 */
export function pushPermissionState(p: PermissionSnapshot, introSeen: boolean): PushPermission {
  if (p.granted) return 'granted';
  if (!p.canAskAgain) return 'blocked';
  if (p.status === 'undetermined' || !introSeen) return 'undetermined';
  return 'denied';
}
