/**
 * Rides whose screen was open in this app session. The map opens an open ride by itself
 * only once (app start, a ride ordered from another phone or by the operator), so the
 * rider can go back to the map while the ride goes on.
 */
const shown = new Set<string>();

export function markRideShown(rideId: string): void {
  shown.add(rideId);
}

export function wasRideShown(rideId: string): boolean {
  return shown.has(rideId);
}

/**
 * What to do about an open ride nobody looked at yet: open it when the rider is on the map;
 * on any other screen (ordering, a cargo order, paying) only a notice they may tap — a ride
 * for later whose search starts must not take the screen away in the middle of an order.
 */
export function takeoverFor(
  rideId: string | null | undefined,
  alreadyShown: boolean,
  onMap: boolean,
): 'open' | 'notice' | null {
  if (!rideId || alreadyShown) return null;
  return onMap ? 'open' : 'notice';
}

/** The notice's text: a ride for later searching now, else an open ride (the operator's). */
export function rideNoticeText(ride: { scheduledFor?: string | null }): string {
  return ride.scheduledFor
    ? 'Oldindan buyurtmangiz uchun haydovchi qidirilmoqda'
    : 'Sizda ochiq buyurtma bor';
}

// The notice (one at a time) --------------------------------------------------------------

export interface RideNotice {
  rideId: string;
  text: string;
}

let notice: RideNotice | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showRideNotice(next: RideNotice): void {
  notice = next;
  emit();
}

export function dismissRideNotice(): void {
  if (!notice) return;
  notice = null;
  emit();
}

export function getRideNotice(): RideNotice | null {
  return notice;
}

export function subscribeRideNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
