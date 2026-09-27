/** Display formatting. Money is whole so'm; times are shown in Tashkent (UTC+5, no DST). */

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const NBSP = '\u00a0';

/** 45000 -> "45 000 so‘m" */
export function formatMoney(amount: number): string {
  return `${formatNumber(amount)}${NBSP}so‘m`;
}

export function formatNumber(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.round(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** "+3 000 so‘m" for option price deltas, empty for free options. */
export function formatDelta(delta: number): string {
  if (delta === 0) return '';
  return `${delta > 0 ? '+' : '−'}${formatMoney(Math.abs(delta))}`;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}${NBSP}m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace('.', ',')}${NBSP}km`;
}

/** Whole minutes, at least 1: "7 daq", "1 soat 5 daq". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m}${NBSP}daq`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}${NBSP}soat ${rest}${NBSP}daq` : `${h}${NBSP}soat`;
}

/** A countdown or stopwatch: 65 -> "1:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function tashkent(date: Date): Date {
  return new Date(date.getTime() + TASHKENT_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "14:05" in Tashkent time. */
export function formatTime(iso: string | Date): string {
  const d = tashkent(new Date(iso));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export const MONTHS = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];

/** "Bugun, 14:05", "Kecha, 09:10" or "3 mart, 18:40". */
export function formatDateTime(iso: string | Date, now: Date = new Date()): string {
  const d = tashkent(new Date(iso));
  const today = tashkent(now);
  const dayMs = 86_400_000;
  const dayIndex = (x: Date) => Math.floor(x.getTime() / dayMs);
  const diff = dayIndex(today) - dayIndex(d);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (diff === 0) return `Bugun, ${time}`;
  if (diff === 1) return `Kecha, ${time}`;
  if (diff === -1) return `Ertaga, ${time}`;
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === today.getUTCFullYear()
    ? `${date}, ${time}`
    : `${date} ${d.getUTCFullYear()}, ${time}`;
}

/** The Tashkent calendar day of a moment: "2026-03-03". */
export function tashkentDay(date: Date): string {
  const d = tashkent(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "2026-03-03" -> "3 mart". */
export function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : day;
}

/** "+998901234567" -> "+998 90 123 45 67" */
export function formatPhone(phone: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/** Same normalisation as the API: accepts "90 123 45 67", "998901234567", "+998 90…". */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '');
  if (/^\+998\d{9}$/.test(digits)) return digits;
  if (/^998\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{9}$/.test(digits)) return `+998${digits}`;
  return null;
}

/** Formats the 9 local digits as they are typed: "90 123 45 67". */
export function formatLocalPhoneInput(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 9);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return parts.join(' ');
}

/** A place in one line: the address, else the landmark, else the coordinates. */
export function placeLine(p: {
  address: string | null;
  landmark?: string | null;
  lat: number;
  lng: number;
}): string {
  return p.address || p.landmark || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

/** First name for friendly lines: "Aziz Karimov" -> "Aziz". */
export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first || null;
}
