import { useSyncExternalStore } from 'react';
import type { LatLng, PaymentMethod, RideClass, RideOption } from '../api/types';

/** A trip end as the rider chose it: a map pin with the address line we found for it. */
export interface TripPoint extends LatLng {
  address: string | null;
}

/**
 * The trip being put together, across the map, search and tariff screens. In memory:
 * a half-built order is not worth restoring after the app was killed.
 */
export interface TripDraft {
  pickup: TripPoint | null;
  dropoff: TripPoint | null;
  /** Orientir for the driver: "opposite school No. 5". Common in Uzbek addressing. */
  landmark: string;
  comment: string;
  options: RideOption[];
  rideClass: RideClass;
  paymentMethod: PaymentMethod;
  /** Asks the home map to move (a pickup chosen by search); the key repeats a move. */
  moveMap: { lat: number; lng: number; key: number } | null;
}

const INITIAL: TripDraft = {
  pickup: null,
  dropoff: null,
  landmark: '',
  comment: '',
  options: [],
  rideClass: 'economy',
  paymentMethod: 'cash',
  moveMap: null,
};

let draft: TripDraft = INITIAL;
const listeners = new Set<() => void>();

export function getDraft(): TripDraft {
  return draft;
}

export function updateDraft(patch: Partial<TripDraft>): void {
  draft = { ...draft, ...patch };
  for (const l of listeners) l();
}

/** A pickup chosen elsewhere than on the map (search, saved place): the map follows. */
export function choosePickup(point: TripPoint): void {
  updateDraft({ pickup: point, moveMap: { lat: point.lat, lng: point.lng, key: Date.now() } });
}

export function toggleOption(option: RideOption): void {
  const on = draft.options.includes(option);
  updateDraft({
    options: on ? draft.options.filter((o) => o !== option) : [...draft.options, option],
  });
}

/** After an order: the next trip starts from scratch but keeps the rider's habits. */
export function resetAfterOrder(): void {
  updateDraft({
    dropoff: null,
    landmark: '',
    comment: '',
    options: [],
    moveMap: null,
  });
}

export function resetDraft(): void {
  draft = INITIAL;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDraft(): TripDraft {
  return useSyncExternalStore(subscribe, getDraft, getDraft);
}
