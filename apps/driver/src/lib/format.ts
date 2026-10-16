import { liveTable, t } from '../i18n/dictionary';
import { tashkentClock, tashkentDate } from './when';

/** 45000 -> "45 000 so‘m" / "45 000 сум" (thousands separated by spaces, as prices are written). */
export function som(amount: number): string {
  return `${amount < 0 ? '−' : ''}${digits(amount)} ${t('common.units.som')}`;
}

/** 45000 -> "45 000" (for very large figures with the currency set apart). */
export function digits(amount: number): string {
  return Math.abs(Math.round(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** 850 -> "850 m", 3420 -> "3,4 km" ("850 м", "3,4 км") */
export function distance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} ${t('common.units.m')}`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} ${t('common.units.km')}`;
}

/** Seconds -> "~4 daqiqa" / "~4 мин" (at least one minute). */
export function etaMinutes(seconds: number): string {
  return t('common.units.eta', { minutes: Math.max(1, Math.round(seconds / 60)) });
}

/** 125 -> "2:05" (a running timer). */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = pad(s % 60);
  return h > 0 ? `${h}:${pad(m)}:${sec}` : `${m}:${sec}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * "14:05" in Tashkent, whatever the phone's time zone (like the rest of the app: offers,
 * intercity times, the rider app). With the device zone a phone set to UTC showed a
 * top-up valid "till 13:09" at 17:39 Tashkent time.
 */
export function time(iso: string | null): string {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(at) ? '' : tashkentClock(at);
}

/** "26.09 14:05" in Tashkent. */
export function dateTime(iso: string | null): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return '';
  const [, m, d] = tashkentDate(at).split('-');
  return `${d}.${m} ${tashkentClock(at)}`;
}

/** "2026-12-31" -> "31.12.2026" */
export function date(ymd: string | null): string {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/** "26.09 23:59 gacha" / "до 26.09 23:59": a moment something lasts until. */
export function until(when: string): string {
  return t('common.units.until', { time: when });
}

/** "+998901234567" -> "+998 90 123 45 67" */
export function formatPhone(phone: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/**
 * The nine national digits of an Uzbek number typed in any common way, or null:
 * "90 123-45-67", "+998901234567", "998 90 123 45 67".
 */
export function uzPhoneDigits(input: string): string | null {
  const d = input.replace(/[\s\-()+]/g, '');
  if (/^998\d{9}$/.test(d)) return d.slice(3);
  if (/^\d{9}$/.test(d)) return d;
  return null;
}

// Label tables: each label is read in the app's language on access (src/i18n `liveTable`).

export const PAYMENT_METHODS: Record<string, string> = liveTable({
  cash: 'common.payment.cash',
  card: 'common.payment.card',
});

export const RIDE_CLASSES: Record<string, string> = liveTable({
  economy: 'common.classes.economy',
  comfort: 'common.classes.comfort',
  minivan: 'common.classes.minivan',
  business: 'common.classes.business',
  cargo_s: 'common.classes.cargo_s',
  cargo_m: 'common.classes.cargo_m',
});

export const RIDE_OPTIONS: Record<string, string> = liveTable({
  child_seat: 'common.options.child_seat',
  luggage: 'common.options.luggage',
  pets: 'common.options.pets',
  ac: 'common.options.ac',
});

export const RIDE_STATUSES: Record<string, string> = liveTable({
  scheduled: 'common.rideStatus.scheduled',
  searching: 'common.rideStatus.searching',
  driver_assigned: 'common.rideStatus.driver_assigned',
  driver_arrived: 'common.rideStatus.driver_arrived',
  in_progress: 'common.rideStatus.in_progress',
  completed: 'common.rideStatus.completed',
  cancelled: 'common.rideStatus.cancelled',
});

export const LEDGER_KINDS: Record<string, string> = liveTable({
  topup: 'common.ledgerKind.topup',
  commission: 'common.ledgerKind.commission',
  tax: 'common.ledgerKind.tax',
  pass: 'common.ledgerKind.pass',
  adjustment: 'common.ledgerKind.adjustment',
  card_fare: 'common.ledgerKind.card_fare',
  payout: 'common.ledgerKind.payout',
  cancel_fee: 'common.ledgerKind.cancel_fee',
  cancel_fee_collected: 'common.ledgerKind.cancel_fee_collected',
  deposit: 'common.ledgerKind.deposit',
  promo_compensation: 'common.ledgerKind.promo_compensation',
  tip: 'common.ledgerKind.tip',
});

/** What each ledger entry means, one line (the ledger screen). */
export const LEDGER_HINTS: Record<string, string> = liveTable({
  topup: 'common.ledgerHint.topup',
  commission: 'common.ledgerHint.commission',
  tax: 'common.ledgerHint.tax',
  pass: 'common.ledgerHint.pass',
  adjustment: 'common.ledgerHint.adjustment',
  card_fare: 'common.ledgerHint.card_fare',
  payout: 'common.ledgerHint.payout',
  cancel_fee: 'common.ledgerHint.cancel_fee',
  cancel_fee_collected: 'common.ledgerHint.cancel_fee_collected',
  deposit: 'common.ledgerHint.deposit',
  promo_compensation: 'common.ledgerHint.promo_compensation',
  tip: 'common.ledgerHint.tip',
});

/** Why a ride's commission was lower than the percentage (`commissionNote`). */
export const COMMISSION_NOTES: Record<string, string> = liveTable({
  promo: 'common.commissionNote.promo',
  pass: 'common.commissionNote.pass',
  daily_cap: 'common.commissionNote.daily_cap',
  weekly_cap: 'common.commissionNote.weekly_cap',
  trip_cap: 'common.commissionNote.trip_cap',
});

/** A cancelled cash ride's fee (`fare.cancellationFeeStatus`): the next cash ride collects it. */
export const CANCEL_FEE_STATUS: Record<string, string> = liveTable({
  owed: 'common.cancelFeeStatus.owed',
  collected: 'common.cancelFeeStatus.collected',
  waived: 'common.cancelFeeStatus.waived',
});

/**
 * A date typed on the number pad (Android has no keypad with a dot): the dots come by
 * themselves, "01012000" -> "01.01.2000"; a dot appears once the next part is started, so
 * backspace works as expected.
 */
export function dateInput(typed: string): string {
  const d = typed.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('.');
}
