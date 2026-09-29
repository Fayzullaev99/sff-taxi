import { som } from './format';
import { type RideStep, stepOf } from './ride-flow';

/**
 * The three services on the same rides (docs/shared-rides.md §8): a taxi ride, cargo
 * ("Yuk tashish", a van/pickup/truck with optional loaders) and delivery ("Yetkazib berish",
 * a parcel in a taxi car, the sender not in it). Every field is optional on the wire: an
 * older API is all taxi. No React Native imports: unit-tested under Node.
 */

export type Service = 'taxi' | 'cargo' | 'delivery';

export const SERVICE_LABELS: Record<Service, string> = {
  taxi: 'Taksi',
  cargo: 'Yuk tashish',
  delivery: 'Yetkazib berish',
};

export const CARGO_CLASS_LABELS: Record<string, string> = {
  cargo_s: 'Kichik yuk (Damas, Labo)',
  cargo_m: 'O‘rta yuk (Gazel, Porter)',
};

export function serviceOf(ride: { service?: string | null } | null | undefined): Service {
  return ride?.service === 'cargo' || ride?.service === 'delivery' ? ride.service : 'taxi';
}

export interface CargoInfo {
  loaders?: number | null;
  riderRides?: boolean | null;
  description?: string | null;
  weightKg?: number | null;
}

export interface ParcelInfo {
  description?: string | null;
  weightKg?: number | null;
}

/** What a cargo order asks for, as short lines for the offer and ride screens. */
export function cargoLines(cargo: CargoInfo | null | undefined, rideClass?: string): string[] {
  const out: string[] = [];
  if (rideClass && CARGO_CLASS_LABELS[rideClass]) out.push(CARGO_CLASS_LABELS[rideClass]!);
  if (!cargo) return out;
  const loaders = Math.max(0, Math.floor(cargo.loaders ?? 0));
  out.push(loaders > 0 ? `Yukchi: ${loaders} kishi` : 'Yukchisiz');
  if (typeof cargo.weightKg === 'number' && cargo.weightKg > 0) {
    out.push(`Taxminan ${cargo.weightKg} kg`);
  }
  if (cargo.riderRides) out.push('Mijoz ham boradi (kabinada 1 kishi)');
  const d = cargo.description?.trim();
  if (d) out.push(`Yuk: ${d}`);
  return out;
}

/** The parcel of a delivery, as short lines. */
export function parcelLines(parcel: ParcelInfo | null | undefined): string[] {
  const out: string[] = ['Posilka: jo‘natuvchi mashinada bo‘lmaydi'];
  const d = parcel?.description?.trim();
  if (d) out.push(`Nima: ${d}`);
  if (typeof parcel?.weightKg === 'number' && parcel.weightKg > 0) {
    out.push(`Og‘irligi: ~${parcel.weightKg} kg`);
  }
  return out;
}

/**
 * The ride step with the service's words: a delivery picks up and hands over a parcel, a
 * cargo ride loads and unloads. The actions stay arrive → start → complete.
 */
export function serviceStep(status: string, service: Service): RideStep | null {
  const step = stepOf(status);
  if (!step || service === 'taxi') return step;
  if (service === 'delivery') {
    const words: Record<string, Pick<RideStep, 'title' | 'button'>> = {
      driver_assigned: { title: 'Posilkani olishga boring', button: 'Yetib keldim' },
      driver_arrived: { title: 'Posilkani oling', button: 'Posilkani oldim — Boshlash' },
      in_progress: { title: 'Qabul qiluvchiga boring', button: 'Posilkani topshirdim' },
    };
    return { ...step, ...words[status] };
  }
  const words: Record<string, Pick<RideStep, 'title' | 'button'>> = {
    driver_assigned: { title: 'Yuk olinadigan joyga boring', button: 'Yetib keldim' },
    driver_arrived: { title: 'Yuklash', button: 'Yuklandi — Boshlash' },
    in_progress: { title: 'Yukni manzilga olib boring', button: 'Yukni topshirdim — Yakunlash' },
  };
  return { ...step, ...words[status] };
}

/** The delivery's recipient is shown (with a call button) once the parcel is on its way. */
export function showRecipient(ride: {
  service?: string | null;
  status: string;
  delivery?: { recipientName?: string | null; recipientPhone?: string | null } | null;
}): boolean {
  return (
    serviceOf(ride) === 'delivery' &&
    (ride.status === 'in_progress' || ride.status === 'completed') &&
    !!(ride.delivery?.recipientName || ride.delivery?.recipientPhone)
  );
}

/** "Oldindan to‘langan 10 000 so‘m, naqd oling 40 000 so‘m" when part was paid in advance. */
export function depositLine(deposit: number | null | undefined, cashToTake: number): string | null {
  if (!deposit || deposit <= 0) return null;
  return `Oldindan to‘langan ${som(deposit)}, naqd oling ${som(Math.max(0, cashToTake))}`;
}

/** Words for "the rider" by service (the confirm dialogs and the done screen). */
export function customerWord(service: Service): string {
  return service === 'taxi' ? 'Yo‘lovchi' : 'Mijoz';
}

/**
 * A cargo car (Damas, Gazel…) gets cargo orders only: passenger settings (sharing the car,
 * people riding without the app, the heading filter, women riders) do not apply to it.
 */
export function isCargoCar(
  me: { vehicle?: { service?: string | null } | null } | null | undefined,
) {
  return me?.vehicle?.service === 'cargo';
}
