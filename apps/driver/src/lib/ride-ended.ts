/**
 * Rides that left the driver's car without the driver ending them: the rider or the operator
 * cancelled, or the operator gave the ride to another driver. Worked out from the current
 * ride as it changes (the event stream, a push or the poll may be first to notice), so the
 * driver is told whichever of them brought the news.
 */
import { ridePool } from './pool';

/** One ride in the car: the current ride and every ride on the shared car's stop list. */
export interface CarRide {
  id: string;
  number: number | null;
  status: string;
}

export function carRides(
  ride: { id: string; number: number; status: string; pool?: unknown } | null | undefined,
): CarRide[] {
  if (!ride) return [];
  const list: CarRide[] = [{ id: ride.id.toLowerCase(), number: ride.number, status: ride.status }];
  for (const s of ridePool(ride)?.stops ?? []) {
    const id = s.rideId.toLowerCase();
    if (!list.some((r) => r.id === id)) {
      list.push({ id, number: s.number ?? null, status: s.status });
    }
  }
  return list;
}

/** Rides in `before` that are no longer in the car. */
export function goneRides(before: CarRide[], after: CarRide[]): CarRide[] {
  const still = new Set(after.map((r) => r.id));
  return before.filter((r) => !still.has(r.id));
}

/**
 * How a ride that left the car ended, from the ride as the API now shows it to this driver:
 * `missing` (404: no longer this driver's) = taken away; cancelled; anything else (completed,
 * or still ours and the list only moved on) = nothing to say.
 */
export function endingOf(now: { status: string } | 'missing'): 'cancelled' | 'taken' | null {
  if (now === 'missing') return 'taken';
  return now.status === 'cancelled' ? 'cancelled' : null;
}

/** The alert for it. */
export function rideEndedAlert(
  ride: CarRide,
  ending: 'cancelled' | 'taken',
): { title: string; text: string } {
  const name = ride.number ? `Buyurtma #${ride.number}` : 'Buyurtma';
  if (ending === 'taken') {
    return {
      title: `${name} sizdan olindi`,
      text: 'Operator buyurtmani boshqa haydovchiga berdi. Unga bormang.',
    };
  }
  return {
    title: `${name} bekor qilindi`,
    text:
      ride.status === 'driver_arrived'
        ? 'Yo‘lovchi bekor qildi. Bepul kutish tugagan bo‘lsa, bekor qilish haqi sizga yoziladi (naqd safarda — yo‘lovchi keyingi safarida to‘laganda).'
        : 'Yo‘lovchi yoki operator buyurtmani bekor qildi. Liniyada qolasiz.',
  };
}
