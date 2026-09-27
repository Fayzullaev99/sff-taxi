/** Pure helpers for push notifications (unit-tested without Expo). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ride a tapped notification is about. The API's notifier sends
 * `data: { kind, rideId }` (driver_assigned, driver_arrived, completed, cancelled, ...).
 */
export function rideIdFromData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.rideId !== 'string') return null;
  return UUID.test(d.rideId) ? d.rideId : null;
}

/** The intercity booking a tapped notification is about (`data: { tripId, bookingId }`). */
export function bookingIdFromData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.bookingId !== 'string') return null;
  return UUID.test(d.bookingId) ? d.bookingId : null;
}

/** The locale the API should write pushes in; Russian phones get Russian, the rest Uzbek. */
export function pushLocale(languageTag: string | null | undefined): 'uz' | 'ru' {
  return languageTag?.toLowerCase().startsWith('ru') ? 'ru' : 'uz';
}

/** EAS project id from the app config, else from the environment; null in plain dev. */
export function resolveProjectId(
  extra: { eas?: { projectId?: unknown } } | null | undefined,
  easConfigProjectId: unknown,
  env: string | undefined,
): string | null {
  const candidates = [extra?.eas?.projectId, easConfigProjectId, env];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

/** The support ticket a tapped notification is about (`data: { kind, rideId, complaintId }`). */
export function complaintIdFromData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.complaintId !== 'string') return null;
  return UUID.test(d.complaintId) ? d.complaintId : null;
}

/** Where a tapped push leads. */
export type PushTarget =
  | { screen: 'ride'; id: string }
  | { screen: 'booking'; id: string }
  | { screen: 'complaint'; id: string };

/**
 * The screen for a tapped push. An operator's answer or decision on a complaint
 * (`complaint_answered`, `complaint_resolved`) opens the ticket, although it names the ride
 * too; a refund (`refund_pending`, `refunded`) and every ride push open the ride; intercity
 * pushes open the booking.
 */
export function pushTarget(data: unknown): PushTarget | null {
  const complaintId = complaintIdFromData(data);
  if (complaintId) return { screen: 'complaint', id: complaintId };
  const rideId = rideIdFromData(data);
  if (rideId) return { screen: 'ride', id: rideId };
  const bookingId = bookingIdFromData(data);
  if (bookingId) return { screen: 'booking', id: bookingId };
  return null;
}

/** What `Notifications.getPermissionsAsync()` reports, reduced to what the app uses. */
export interface PermissionSnapshot {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
  /** iOS "provisional" authorization delivers quietly: good enough for status updates. */
  provisional?: boolean;
}

/**
 * Whether push is on, can still be asked for, or only the system settings can turn it on.
 * On Android 13+ expo-notifications reports status "denied" with `canAskAgain: true` for a
 * permission that was never asked (notifications are simply not enabled yet): that must
 * still count as askable, or the prompt after the first order never appears.
 */
export function pushPermissionState(p: PermissionSnapshot): 'granted' | 'undetermined' | 'denied' {
  if (p.granted || p.provisional) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}
