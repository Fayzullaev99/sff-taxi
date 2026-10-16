import { liveTable, t } from '../i18n/dictionary';
import { som } from './format';
import { type RideStep, stepOf } from './ride-flow';

/**
 * The three services on the same rides (docs/shared-rides.md §8): a taxi ride, cargo
 * ("Yuk tashish", a van/pickup/truck with optional loaders) and delivery ("Yetkazib berish",
 * a parcel in a taxi car, the sender not in it). Every field is optional on the wire: an
 * older API is all taxi. No React Native imports: unit-tested under Node.
 */

export type Service = 'taxi' | 'cargo' | 'delivery';

/** Label tables: each label is read in the app's language on access (src/i18n `liveTable`). */
export const SERVICE_LABELS: Record<Service, string> = liveTable({
  taxi: 'common.services.taxi',
  cargo: 'common.services.cargo',
  delivery: 'common.services.delivery',
});

export const CARGO_CLASS_LABELS: Record<string, string> = liveTable({
  cargo_s: 'ride.service.cargoS',
  cargo_m: 'ride.service.cargoM',
});

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
  out.push(
    loaders > 0 ? t('ride.service.loaders', { count: loaders }) : t('ride.service.noLoaders'),
  );
  if (typeof cargo.weightKg === 'number' && cargo.weightKg > 0) {
    out.push(t('ride.service.aboutKg', { kg: cargo.weightKg }));
  }
  if (cargo.riderRides) out.push(t('ride.service.customerRides'));
  const d = cargo.description?.trim();
  if (d) out.push(t('ride.service.load', { text: d }));
  return out;
}

/** The parcel of a delivery, as short lines. */
export function parcelLines(parcel: ParcelInfo | null | undefined): string[] {
  const out: string[] = [t('ride.service.parcel')];
  const d = parcel?.description?.trim();
  if (d) out.push(t('ride.service.what', { text: d }));
  if (typeof parcel?.weightKg === 'number' && parcel.weightKg > 0) {
    out.push(t('ride.service.weight', { kg: parcel.weightKg }));
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
      driver_assigned: {
        title: t('ride.service.deliveryToPickupTitle'),
        button: t('ride.flow.arrived'),
      },
      driver_arrived: {
        title: t('ride.service.deliveryPickTitle'),
        button: t('ride.service.deliveryStart'),
      },
      in_progress: {
        title: t('ride.service.deliveryToRecipientTitle'),
        button: t('ride.service.deliveryComplete'),
      },
    };
    return { ...step, ...words[status] };
  }
  const words: Record<string, Pick<RideStep, 'title' | 'button'>> = {
    driver_assigned: {
      title: t('ride.service.cargoToPickupTitle'),
      button: t('ride.flow.arrived'),
    },
    driver_arrived: {
      title: t('ride.service.cargoLoadTitle'),
      button: t('ride.service.cargoStart'),
    },
    in_progress: {
      title: t('ride.service.cargoToDropoffTitle'),
      button: t('ride.service.cargoComplete'),
    },
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
  return t('ride.service.deposit', {
    deposit: som(deposit),
    cash: som(Math.max(0, cashToTake)),
  });
}

/**
 * Words for "the rider" by service (the confirm dialogs and the done screen): the plain
 * word, or the form after "from" ("from the rider": Russian declines it).
 */
export function customerWord(service: Service, form: 'plain' | 'from' = 'plain'): string {
  if (form === 'from') {
    return t(service === 'taxi' ? 'ride.service.riderFrom' : 'ride.service.customerFrom');
  }
  return t(service === 'taxi' ? 'ride.service.rider' : 'ride.service.customer');
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
