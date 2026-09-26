/** 45000 -> "45 000 so‘m" (thousands separated by spaces, as prices are written in Uzbekistan). */
export function som(amount: number): string {
  return `${amount < 0 ? '−' : ''}${digits(amount)} so‘m`;
}

/** 45000 -> "45 000" (for very large figures with the currency set apart). */
export function digits(amount: number): string {
  return Math.abs(Math.round(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** 850 -> "850 m", 3420 -> "3,4 km" */
export function distance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Seconds -> "~4 daqiqa" (at least one minute). */
export function etaMinutes(seconds: number): string {
  return `~${Math.max(1, Math.round(seconds / 60))} daqiqa`;
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

/** "14:05" in the device's time zone. */
export function time(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "26.09 14:05" */
export function dateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${time(iso)}`;
}

/** "2026-12-31" -> "31.12.2026" */
export function date(ymd: string | null): string {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
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

export const PAYMENT_METHODS: Record<string, string> = {
  cash: 'Naqd',
  card: 'Karta',
};

export const RIDE_CLASSES: Record<string, string> = {
  economy: 'Ekonom',
  comfort: 'Komfort',
};

export const RIDE_OPTIONS: Record<string, string> = {
  child_seat: 'Bolalar o‘rindig‘i',
  luggage: 'Katta yuk',
  pets: 'Uy hayvoni',
  ac: 'Konditsioner',
};

export const RIDE_STATUSES: Record<string, string> = {
  searching: 'Haydovchi qidirilmoqda',
  driver_assigned: 'Yo‘lovchiga borilmoqda',
  driver_arrived: 'Yo‘lovchi kutilmoqda',
  in_progress: 'Safarda',
  completed: 'Yakunlangan',
  cancelled: 'Bekor qilingan',
};

export const LEDGER_KINDS: Record<string, string> = {
  topup: 'To‘ldirish',
  commission: 'Komissiya',
  tax: 'Soliq (1%)',
  pass: 'Abonement',
  adjustment: 'Tuzatish',
};

/** Why a ride's commission was lower than the percentage (`commissionNote`). */
export const COMMISSION_NOTES: Record<string, string> = {
  promo: '0% aksiya',
  pass: 'Abonement',
  daily_cap: 'Kunlik chegara',
  weekly_cap: 'Haftalik chegara',
  trip_cap: 'Safar chegarasi',
};
