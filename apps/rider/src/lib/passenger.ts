import type { RecentPassenger } from '../api/types';
import { formatPhone, normalizePhone } from './format';

/**
 * "Boshqa odam uchun": the rider orders, tracks and pays; someone else rides. The passenger
 * is a name and an Uzbek phone; the driver calls them and they get an SMS with the car and
 * the live link once a driver is found. Pure, unit-tested.
 */
export interface PassengerCheck {
  ok: boolean;
  name: string;
  phone: string | null;
  nameError: string | null;
  phoneError: string | null;
}

/** The passenger as typed: a name and a valid Uzbek phone that is not the rider's own. */
export function checkPassenger(
  name: string,
  phone: string,
  ownPhone: string | null | undefined,
): PassengerCheck {
  const n = name.trim();
  const p = normalizePhone(phone);
  const nameError = n.length === 0 ? 'Yo‘lovchining ismini yozing' : null;
  const phoneError = !phone.trim()
    ? 'Yo‘lovchining telefonini yozing'
    : p === null
      ? 'Telefon raqami noto‘g‘ri: +998 XX XXX XX XX'
      : ownPhone && p === ownPhone
        ? 'Bu sizning raqamingiz: o‘zingiz uchun bo‘lsa, bu tanlovni o‘chiring'
        : null;
  return { ok: !nameError && !phoneError, name: n, phone: p, nameError, phoneError };
}

/** A recent passenger as a chip: "Onam · +998 90 123 45 67". */
export function passengerChip(p: Pick<RecentPassenger, 'name' | 'phone'>): string {
  return `${p.name} · ${formatPhone(p.phone)}`;
}

/** The ride screen's line about who rides, or null for the rider's own ride. */
export function passengerLine(
  passenger: { name: string | null; phone: string | null } | null | undefined,
): string | null {
  if (!passenger) return null;
  const phone = passenger.phone ? ` · ${formatPhone(passenger.phone)}` : '';
  return `Yo‘lovchi: ${passenger.name ?? 'boshqa odam'}${phone}`;
}
