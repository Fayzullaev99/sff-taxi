import {
  type ComplaintResolution,
  COMPLAINT_RESOLUTIONS,
  type ComplaintType,
  type FiscalRules,
  type OutboxEvent,
} from '../api/types';
import { som } from './format';

/** Resolutions that fit a complaint type first (a lost item is mostly "returned"). */
export function resolutionsFor(type: ComplaintType): ComplaintResolution[] {
  const first: ComplaintResolution[] =
    type === 'lost_item'
      ? ['item_returned', 'no_action']
      : type === 'price'
        ? ['refund', 'rejected']
        : type === 'driver_behaviour' || type === 'safety'
          ? ['driver_warned', 'driver_blocked']
          : [];
  return [...first, ...COMPLAINT_RESOLUTIONS.filter((r) => !first.includes(r))];
}

/** Where an outbox event's payload points: a ride, a trip, a complaint, a driver. */
export function eventLink(e: Pick<OutboxEvent, 'payload'>): { to: string; label: string } | null {
  const p = e.payload ?? {};
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null);
  const rideId = str('rideId');
  if (rideId) return { to: `/rides/${rideId}`, label: 'safar' };
  const tripId = str('tripId');
  if (tripId) return { to: `/intercity/${tripId}`, label: 'qatnov' };
  const complaintId = str('complaintId');
  if (complaintId) return { to: `/complaints?id=${complaintId}`, label: 'shikoyat' };
  const driverId = str('driverId');
  if (driverId) return { to: `/drivers/${driverId}`, label: 'haydovchi' };
  return null;
}

/** What the API accepts for the receipt settings (apps/api settings FiscalRules). */
export function fiscalProblems(r: FiscalRules): Partial<Record<keyof FiscalRules, string>> {
  const out: Partial<Record<keyof FiscalRules, string>> = {};
  const name = (v: string) => (v.trim().length < 3 || v.trim().length > 128 ? '3–128 belgi' : null);
  const city = name(r.city_item_name);
  if (city) out.city_item_name = city;
  const intercity = name(r.intercity_item_name);
  if (intercity) out.intercity_item_name = intercity;
  // cargo and delivery names: absent on older API builds (their defaults apply)
  for (const key of ['cargo_item_name', 'delivery_item_name'] as const) {
    const v = r[key];
    const problem = v === undefined ? null : name(v);
    if (problem) out[key] = problem;
  }
  if (!/^\d{17}$/.test(r.mxik_code)) out.mxik_code = 'MXIK kodi 17 ta raqam';
  if (!/^\d{1,10}$/.test(r.package_code)) out.package_code = 'Qadoq kodi: 1–10 ta raqam';
  if (!(r.vat_percent >= 0 && r.vat_percent <= 20)) out.vat_percent = '0 dan 20 gacha';
  return out;
}

/** The settings still hold the placeholder codes: nothing can be sent to the tax authority. */
export const isPlaceholder = (r: FiscalRules) => /^0+$/.test(r.mxik_code);

export type EntryKind = 'topup' | 'payout' | 'adjustment';

/**
 * What an operator's ledger entry must carry before it is sent (the API checks the same).
 * `max` caps a payout: what can be paid out now (card money owed, within the balance).
 */
export function entryProblems(
  kind: EntryKind,
  amount: number | null,
  note: string,
  max: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!amount) out.amount = 'Summani kiriting';
  else if (kind === 'payout' && amount > max) {
    out.amount = `Hozir ko‘pi bilan ${som(Math.max(0, max))} o‘tkazish mumkin`;
  }
  if (kind === 'adjustment' && !note.trim()) out.note = 'Tuzatish uchun izoh yozing';
  if (kind === 'payout' && note.trim().length < 3) {
    out.note = 'Karta yoki hisob raqami, o‘tkazma raqamini yozing';
  }
  return out;
}
