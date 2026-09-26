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
