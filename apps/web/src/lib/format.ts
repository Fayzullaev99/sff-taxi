import type {
  DispatchStage,
  DocumentKind,
  DriverStatus,
  LedgerKind,
  LiveDriverState,
  RideActor,
  RideClass,
  RideOffer,
  RideOption,
  RideStatus,
  VehicleFeature,
} from '../api/types';

/** 45000 -> "45 000" */
export function digits(n: number): string {
  const s = Math.abs(Math.round(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return n < 0 ? `−${s}` : s;
}

/** 45000 -> "45 000 so‘m" */
export function som(amount: number): string {
  return `${digits(amount)} so‘m`;
}

/** Signed amount for ledgers: "+20 000", "−450". */
export function signedSom(amount: number): string {
  return amount > 0 ? `+${digits(amount)}` : digits(amount);
}

/** Parses "45 000", "45000", "45,000"; null when not a whole number. */
export function parseSom(text: string): number | null {
  const d = text.replace(/[\s,.']/g, '');
  if (!/^\d{1,12}$/.test(d)) return null;
  return Number(d);
}

const TASHKENT_OFFSET_MS = 5 * 3600_000;

/** Wall clock in Tashkent (UTC+5, no DST): the panel shows local time whatever the PC says. */
function tashkent(iso: string | number): Date {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  return new Date(t + TASHKENT_OFFSET_MS);
}
const pad = (n: number) => String(n).padStart(2, '0');

/** "14:05" (Tashkent) */
export function time(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = tashkent(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "14:05:09" (Tashkent), for timelines. */
export function timeSec(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = tashkent(iso);
  return `${time(iso)}:${pad(d.getUTCSeconds())}`;
}

/** "26.09.2026" (Tashkent) */
export function date(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : tashkent(iso);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** "26.09 14:05" (Tashkent) */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = tashkent(iso);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} ${time(iso)}`;
}

/** Today in Tashkent as "2026-09-26", for <input type="date">. */
export function tashkentToday(now = Date.now()): string {
  return tashkent(now).toISOString().slice(0, 10);
}

/** "2026-09" of a Tashkent instant; `months` shifts it. */
export function tashkentMonth(now = Date.now(), months = 0): string {
  const d = tashkent(now);
  const shifted = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  return shifted.toISOString().slice(0, 7);
}

/** The Tashkent day ("2026-09-26") an instant falls on. */
export function tashkentDay(iso: string): string {
  return tashkent(iso).toISOString().slice(0, 10);
}

/** Whole years between two YYYY-MM-DD dates (a birthday counts on the day), as the API. */
export function fullYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let years = ty! - fy!;
  if (tm! < fm! || (tm === fm && td! < fd!)) years--;
  return years;
}

/** Days from `from` to `to` (YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

/** "hozirgina", "5 daq", "1 soat 20 daq" */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const m = minutesSince(iso, now);
  if (m < 1) return 'hozirgina';
  if (m < 60) return `${m} daq oldin`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} soat ${m % 60} daq oldin` : `${h} soat oldin`;
  return `${Math.floor(h / 24)} kun oldin`;
}

/** 850 -> "850 m", 12400 -> "12,4 km" */
export function distance(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Seconds as "45 s", "4 daq", "1 soat 5 daq". */
export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} daq`;
  return `${Math.floor(m / 60)} soat ${m % 60} daq`;
}

/** 4.567 -> "4,6" */
export function rating(value: number | null | undefined, places = 1): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(places).replace('.', ',');
}

/** 0.873 -> "87%" */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// Labels ------------------------------------------------------------------------------------

export const RIDE_STATUS: Record<RideStatus, string> = {
  searching: 'Haydovchi qidirilmoqda',
  driver_assigned: 'Haydovchi yo‘lda',
  driver_arrived: 'Haydovchi yetib keldi',
  in_progress: 'Safarda',
  completed: 'Yakunlangan',
  cancelled: 'Bekor qilingan',
};

export const RIDE_STATUS_SHORT: Record<RideStatus, string> = {
  searching: 'Qidiruv',
  driver_assigned: 'Tayinlangan',
  driver_arrived: 'Yetib keldi',
  in_progress: 'Safarda',
  completed: 'Yakunlangan',
  cancelled: 'Bekor',
};

export type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'brand';

export const RIDE_STATUS_TONE: Record<RideStatus, Tone> = {
  searching: 'amber',
  driver_assigned: 'blue',
  driver_arrived: 'blue',
  in_progress: 'green',
  completed: 'neutral',
  cancelled: 'red',
};

export const CLASSES: Record<RideClass, string> = { economy: 'Ekonom', comfort: 'Komfort' };

export const OPTIONS: Record<RideOption, string> = {
  child_seat: 'Bolalar o‘rindig‘i',
  luggage: 'Katta yuk',
  pets: 'Uy hayvoni',
  ac: 'Konditsioner',
};

export const FEATURES: Record<VehicleFeature, string> = {
  ac: 'Konditsioner',
  child_seat: 'Bolalar o‘rindig‘i',
  pets: 'Uy hayvoni mumkin',
  big_trunk: 'Katta yukxona (gazsiz)',
};

export const ACTORS: Record<RideActor, string> = {
  rider: 'Yo‘lovchi',
  driver: 'Haydovchi',
  operator: 'Operator',
  system: 'Tizim',
};

export const CHANNELS: Record<string, string> = { app: 'Ilova', phone: 'Telefon' };

export const STAGES: Record<DispatchStage, string> = {
  direct: 'Navbat bilan taklif',
  broadcast: 'Hammaga e’lon',
  operator: 'Operator kutilmoqda',
};

export const DRIVER_STATE: Record<LiveDriverState, string> = {
  free: 'Bo‘sh',
  offered: 'Taklif ko‘rmoqda',
  busy: 'Buyurtmada',
};

export const DRIVER_STATUS: Record<DriverStatus, string> = {
  pending: 'Tekshiruvda',
  active: 'Faol',
  rejected: 'Rad etilgan',
  blocked: 'Bloklangan',
};

export const DRIVER_STATUS_TONE: Record<DriverStatus, Tone> = {
  pending: 'amber',
  active: 'green',
  rejected: 'neutral',
  blocked: 'red',
};

export const DOCUMENTS: Record<DocumentKind, string> = {
  licence_card: 'Litsenziya kartochkasi',
  driver_licence: 'Haydovchilik guvohnomasi',
  passport: 'Pasport',
  vehicle_registration: 'Texpasport',
  insurance: 'Sug‘urta polisi',
  vehicle_photo: 'Avtomobil surati',
  selfie: 'Selfi',
};

export const LEDGER_KINDS: Record<LedgerKind, string> = {
  topup: 'To‘ldirish',
  commission: 'Komissiya',
  tax: 'Soliq (1%)',
  pass: 'Abonement',
  adjustment: 'Tuzatish',
};

export const OFFER_STATUS: Record<RideOffer['status'], string> = {
  pending: 'Javob kutilmoqda',
  accepted: 'Qabul qildi',
  declined: 'Rad etdi',
  expired: 'Javob bermadi',
  withdrawn: 'Qaytarib olindi',
};

export const OFFER_TONE: Record<RideOffer['status'], Tone> = {
  pending: 'amber',
  accepted: 'green',
  declined: 'red',
  expired: 'neutral',
  withdrawn: 'neutral',
};

/** Ride event types (ride_events.type) as operators read them. */
export const EVENTS: Record<string, string> = {
  requested: 'Buyurtma berildi',
  offered: 'Haydovchiga taklif yuborildi',
  offer_declined: 'Haydovchi rad etdi',
  broadcast: 'Hammaga e’lon qilindi',
  attention: 'Operator e’tibori so‘raldi',
  assigned: 'Haydovchi tayinlandi',
  driver_released: 'Haydovchi buyurtmadan chiqdi',
  arrived: 'Haydovchi yetib keldi',
  started: 'Safar boshlandi',
  completed: 'Safar yakunlandi',
  cancelled: 'Bekor qilindi',
  rated: 'Baho qo‘yildi',
  sos: 'SOS signali',
};
