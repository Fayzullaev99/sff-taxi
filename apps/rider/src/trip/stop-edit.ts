import { useSyncExternalStore } from 'react';
import type { RideStop } from '../api/types';
import { MAX_STOPS, type TripPoint, withStop } from './draft';

/**
 * The stops of a ride that is on, as the rider edits them on the ride's stops screen; the
 * search and map-pick screens write into it (param `ride`) like they write into the order
 * draft. In memory: started from the ride each time the screen opens.
 */
interface StopEdit {
  rideId: string | null;
  stops: TripPoint[];
}

let edit: StopEdit = { rideId: null, stops: [] };
const listeners = new Set<() => void>();

function set(next: StopEdit) {
  edit = next;
  for (const l of listeners) l();
}

/** Starts editing from the ride's stops (addresses as the ride has them). */
export function startStopEdit(rideId: string, stops: readonly RideStop[] | undefined): void {
  set({
    rideId,
    stops: (stops ?? []).map((s) => ({ lat: s.lat, lng: s.lng, address: s.address })),
  });
}

/** Sets the stop at `index` (the next index adds one), never more than MAX_STOPS. */
export function setEditStop(index: number, point: TripPoint): void {
  set({ ...edit, stops: withStop(edit.stops, index, point) });
}

export function removeEditStop(index: number): void {
  set({ ...edit, stops: edit.stops.filter((_, i) => i !== index) });
}

export function getStopEdit(): StopEdit {
  return edit;
}

export { MAX_STOPS };

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStopEdit(): StopEdit {
  return useSyncExternalStore(subscribe, getStopEdit, getStopEdit);
}
