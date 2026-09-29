import { useSyncExternalStore } from 'react';
import type {
  CargoClass,
  FareMode,
  LatLng,
  PaymentMethod,
  RideClass,
  RideOption,
  RideService,
} from '../api/types';

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
  /** A ride for later: when the car should come (ISO), else null (now). Cash only. */
  scheduledFor: string | null;
  /** People riding (1–3: one in front, two in the back). */
  passengers: number;
  /** "Hamroh bilan": agrees to share the car (cash only); kept as a habit. */
  shareable: boolean;
  /** A woman driver only (women riders); kept as a habit. */
  womenOnly: boolean;
  /** A fixed route between towns: a seat (per person, shared) or the whole car. */
  fareMode: FareMode;
  /** Taxi, cargo or delivery (the map's switcher). */
  service: RideService;
  /** Cargo: the class, loaders (0–2), the customer rides in the cab, the load. */
  cargoClass: CargoClass;
  loaders: number;
  riderRides: boolean;
  loadDescription: string;
  /** As typed (kg), checked against the class's payload. */
  loadWeight: string;
  /** Delivery: the parcel and who receives it. */
  parcelDescription: string;
  parcelWeight: string;
  recipientName: string;
  recipientPhone: string;
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
  scheduledFor: null,
  passengers: 1,
  shareable: false,
  womenOnly: false,
  fareMode: 'car',
  service: 'taxi',
  cargoClass: 'cargo_s',
  loaders: 0,
  riderRides: false,
  loadDescription: '',
  loadWeight: '',
  parcelDescription: '',
  parcelWeight: '',
  recipientName: '',
  recipientPhone: '',
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
    scheduledFor: null,
    passengers: 1,
    fareMode: 'car',
    loaders: 0,
    riderRides: false,
    loadDescription: '',
    loadWeight: '',
    parcelDescription: '',
    parcelWeight: '',
    recipientName: '',
    recipientPhone: '',
    moveMap: null,
  });
}

/** Where the price screen of the chosen service is. */
export function orderPath(service: RideService): '/order' | '/cargo' {
  return service === 'cargo' ? '/cargo' : '/order';
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
