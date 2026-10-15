/**
 * Display formatting in the app's language (src/i18n). Money is whole so'm; times are
 * shown in Tashkent (UTC+5, no DST).
 */
import { getLanguage, type Language, t } from '../i18n/dictionary';

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const NBSP = ' ';

/** 45000 -> "45 000 so‘m" / "45 000 сум" */
export function formatMoney(amount: number): string {
  return `${formatNumber(amount)}${NBSP}${t('common.units.som')}`;
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
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}${NBSP}${t('common.units.m')}`;
  const km = (m / 1000).toFixed(m < 10_000 ? 1 : 0).replace('.', ',');
  return `${km}${NBSP}${t('common.units.km')}`;
}

/** Whole minutes, at least 1: "7 daq", "1 soat 5 daq" ("7 мин", "1 ч 5 мин"). */
export function formatMinutes(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const min = t('common.units.min');
  const hour = t('common.units.hour');
  if (m < 60) return `${m}${NBSP}${min}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}${NBSP}${hour} ${rest}${NBSP}${min}` : `${h}${NBSP}${hour}`;
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

/** The Uzbek month names (the source language); `monthName` gives the app language's. */
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

/** The name of a month (0-based) in a date: "mart" / "марта". */
export function monthName(index: number, lang: Language = getLanguage()): string {
  const keys = [
    'common.time.months.m1',
    'common.time.months.m2',
    'common.time.months.m3',
    'common.time.months.m4',
    'common.time.months.m5',
    'common.time.months.m6',
    'common.time.months.m7',
    'common.time.months.m8',
    'common.time.months.m9',
    'common.time.months.m10',
    'common.time.months.m11',
    'common.time.months.m12',
  ] as const;
  return t(keys[index] ?? keys[0], undefined, lang);
}

/** "Bugun, 14:05", "Kecha, 09:10" or "3 mart, 18:40" ("Сегодня, 14:05", "3 марта, 18:40"). */
export function formatDateTime(iso: string | Date, now: Date = new Date()): string {
  const d = tashkent(new Date(iso));
  const today = tashkent(now);
  const dayMs = 86_400_000;
  const dayIndex = (x: Date) => Math.floor(x.getTime() / dayMs);
  const diff = dayIndex(today) - dayIndex(d);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (diff === 0) return `${t('common.time.today')}, ${time}`;
  if (diff === 1) return `${t('common.time.yesterday')}, ${time}`;
  if (diff === -1) return `${t('common.time.tomorrow')}, ${time}`;
  const date = `${d.getUTCDate()} ${monthName(d.getUTCMonth())}`;
  return d.getUTCFullYear() === today.getUTCFullYear()
    ? `${date}, ${time}`
    : `${date} ${d.getUTCFullYear()}, ${time}`;
}

/** The Tashkent calendar day of a moment: "2026-03-03". */
export function tashkentDay(date: Date): string {
  const d = tashkent(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "2026-03-03" -> "3 mart" / "3 марта". */
export function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${Number(m[3])} ${monthName(Number(m[2]) - 1)}` : day;
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

/**
 * How to address a driver: drivers register their name the official way, "Familiya Ism
 * Otasining ismi" (the driver app's application form), so the given name is the second
 * word ("Qodirov Sherzodbek Abdumalikovich" → "Sherzodbek"), not the first like a rider's
 * own name. A single word is used as it is.
 */
export function driverGivenName(fullName: string | null | undefined): string | null {
  const words = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  // a word that does not look like a surname or a patronymic wins (the API's rule too):
  // "Aziz Karimov" and "Karimov Aziz" both give "Aziz"
  return words.find((w) => !SURNAME_OR_PATRONYMIC.test(w)) ?? words[1] ?? words[0] ?? null;
}

const SURNAME_OR_PATRONYMIC =
  /(ov|ev|yov|ova|eva|yova|iy|aya|vich|vna|qizi|o['‘’`]?g['‘’`]?li|ogli)$/i;
