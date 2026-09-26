import type {
  AdminRideItem,
  LiveBoard,
  LiveDriverState,
  Place,
  RideClass,
  RideEvent,
  RideStatus,
  SosEvent,
} from '../api/types';
import { ACTORS, CLASSES, digits, duration, OPTIONS, tashkentDay } from './format';

export const OPEN_STATUSES: RideStatus[] = [
  'searching',
  'driver_assigned',
  'driver_arrived',
  'in_progress',
];

export const isOpen = (s: RideStatus) => OPEN_STATUSES.includes(s);

/** The API assigns a searching ride, or moves an assigned one to another driver. */
export const canAssign = (s: RideStatus) => s === 'searching' || s === 'driver_assigned';

/** Waiting for an operator: the automatic search (direct offers, broadcast) found nobody. */
export function needsDriver(r: Pick<AdminRideItem, 'status' | 'attentionAt'>): boolean {
  return r.status === 'searching' && r.attentionAt !== null;
}

/** Every open alarm as "kind:id", to tell new alarms from ones already raised. */
export function alarmKeys(rides: readonly AdminRideItem[], sos: readonly SosEvent[]): string[] {
  return [
    ...rides.filter(needsDriver).map((r) => `ride:${r.id}`),
    ...sos.filter((s) => !s.resolvedAt).map((s) => `sos:${s.id}`),
  ];
}

/** Keys in `now` that were not in `before` (null before = the first load: nothing is new). */
export function freshKeys(before: ReadonlySet<string> | null, now: readonly string[]): string[] {
  if (!before) return [];
  return now.filter((k) => !before.has(k));
}

/** Cancellation reasons operators pick most (they may type their own). */
export const CANCEL_REASONS = [
  'Yo‘lovchi qo‘ng‘iroq qilib bekor qildi',
  'Haydovchi topilmadi',
  'Yo‘lovchi bilan bog‘lanib bo‘lmadi',
  'Takroriy buyurtma',
  'Manzil noto‘g‘ri kiritilgan',
  'Xavfsizlik sababli',
];

/** "Navoiy ko‘chasi 12 (bozor yonida)" */
export function placeLine(p: Pick<Place, 'address' | 'landmark' | 'lat' | 'lng'>): string {
  const base = p.address ?? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  return p.landmark ? `${base} (${p.landmark})` : base;
}

/** What an event in the ride's history says, for the timeline. */
export function eventDetail(e: RideEvent, driverName: (id: string) => string | null): string {
  const d = e.data ?? {};
  const driver = typeof d.driverId === 'string' ? (driverName(d.driverId) ?? 'haydovchi') : null;
  switch (e.type) {
    case 'requested':
      return [
        d.channel === 'phone' ? 'telefon orqali' : d.channel === 'app' ? 'ilovadan' : null,
        typeof d.class === 'string' ? (CLASSES[d.class as RideClass] ?? d.class) : null,
        typeof d.fare === 'number' ? `${digits(d.fare)} so‘m` : null,
      ]
        .filter(Boolean)
        .join(', ');
    case 'offered':
      return [
        driver,
        d.kind === 'broadcast' ? 'e’lon' : 'to‘g‘ridan-to‘g‘ri',
        typeof d.etaS === 'number' ? `yetib kelish ${duration(d.etaS)}` : null,
        typeof d.score === 'number' ? `reyting balli ${d.score}` : null,
      ]
        .filter(Boolean)
        .join(', ');
    case 'offer_declined':
      return d.kind === 'broadcast' ? 'e’lon' : '';
    case 'broadcast':
      return typeof d.drivers === 'number'
        ? `${d.drivers} ta haydovchiga`
        : Array.isArray(d.drivers)
          ? `${d.drivers.length} ta haydovchiga`
          : '';
    case 'attention':
      return d.reason === 'no_driver' ? 'avtomatik qidiruv haydovchi topmadi' : '';
    case 'assigned':
      return [driver, d.manual ? 'operator tayinladi' : null].filter(Boolean).join(', ');
    case 'driver_released':
      return [driver, d.reason === 'reassigned' ? 'boshqa haydovchiga berildi' : d.reason]
        .filter((x) => typeof x === 'string' && x)
        .join(', ');
    case 'started':
      return typeof d.waitingFee === 'number' && d.waitingFee > 0
        ? `pullik kutish ${digits(d.waitingFee)} so‘m`
        : '';
    case 'completed':
      return [
        typeof d.fare === 'number' ? `jami ${digits(d.fare)} so‘m` : null,
        typeof d.commission === 'number' ? `komissiya ${digits(d.commission)}` : null,
        typeof d.tax === 'number' ? `soliq ${digits(d.tax)}` : null,
      ]
        .filter(Boolean)
        .join(', ');
    case 'cancelled':
      return [
        typeof d.reason === 'string' ? d.reason : null,
        typeof d.fee === 'number' && d.fee > 0 ? `jarima ${digits(d.fee)} so‘m` : null,
      ]
        .filter(Boolean)
        .join(', ');
    case 'rated':
      return typeof d.stars === 'number' ? `${d.stars} yulduz (${ACTORS[e.actor]})` : '';
    default:
      return typeof d.reason === 'string' ? d.reason : '';
  }
}

export function optionsText(options: readonly string[]): string {
  return options.map((o) => OPTIONS[o as keyof typeof OPTIONS] ?? o).join(', ');
}

// Live board filters ----------------------------------------------------------------------

export interface LiveFilters {
  driverStates: LiveDriverState[];
  rideStatuses: RideStatus[];
  rideClass: RideClass | 'all';
  /** Only rides waiting for an operator. */
  attentionOnly: boolean;
}

export const DEFAULT_LIVE_FILTERS: LiveFilters = {
  driverStates: ['free', 'offered', 'busy'],
  rideStatuses: ['searching', 'driver_assigned', 'driver_arrived', 'in_progress'],
  rideClass: 'all',
  attentionOnly: false,
};

/** Rides waiting for an operator first, then searching ones, oldest first within each. */
export function sortForDispatch(rides: readonly AdminRideItem[]): AdminRideItem[] {
  const rank = (r: AdminRideItem) => (needsDriver(r) ? 0 : r.status === 'searching' ? 1 : 2);
  return [...rides].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(a.requestedAt) - Date.parse(b.requestedAt),
  );
}

export function filterLive(board: LiveBoard, f: LiveFilters): LiveBoard {
  return {
    drivers: board.drivers.filter(
      (d) => f.driverStates.includes(d.state) && (f.rideClass === 'all' || d.class === f.rideClass),
    ),
    rides: sortForDispatch(
      board.rides.filter(
        (r) =>
          f.rideStatuses.includes(r.status) &&
          (f.rideClass === 'all' || r.class === f.rideClass) &&
          (!f.attentionOnly || needsDriver(r)),
      ),
    ),
  };
}

export function countByState(board: LiveBoard): Record<LiveDriverState, number> {
  const out: Record<LiveDriverState, number> = { free: 0, offered: 0, busy: 0 };
  for (const d of board.drivers) out[d.state]++;
  return out;
}

// Ride list filters (the API filters by status and phone/number only) ----------------------

export interface ListFilters {
  /** Tashkent days "YYYY-MM-DD", inclusive; empty = no bound. */
  from: string;
  to: string;
  driverId: string;
}

export function filterRides(rides: readonly AdminRideItem[], f: ListFilters): AdminRideItem[] {
  return rides.filter((r) => {
    const day = tashkentDay(r.requestedAt);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.driverId && r.driverId !== f.driverId) return false;
    return true;
  });
}

// Caller lookup ---------------------------------------------------------------------------

export interface KnownPlace extends Place {
  /** How many of the caller's rides started or ended here. */
  uses: number;
}

/** The caller's past pickups and drop-offs, most used first (about 50 m counts as the same). */
export function knownPlaces(rides: readonly AdminRideItem[], limit = 6): KnownPlace[] {
  const byKey = new Map<string, KnownPlace>();
  for (const r of rides) {
    for (const p of [r.pickup, r.dropoff]) {
      const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
      const known = byKey.get(key);
      if (known) {
        known.uses++;
        known.address ??= p.address;
        known.landmark ??= p.landmark;
      } else {
        byKey.set(key, { ...p, uses: 1 });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.uses - a.uses).slice(0, limit);
}
