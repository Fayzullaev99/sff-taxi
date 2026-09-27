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
