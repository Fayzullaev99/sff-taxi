import type {
  BookingStatus,
  ComplaintResolution,
  ComplaintStatus,
  ComplaintType,
  DispatchStage,
  LicenceStatus,
  ReceiptStatus,
  TripStatus,
  DocumentKind,
  DriverStatus,
  FeeStatus,
  IntentStatus,
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
  scheduled: 'Keyinroqqa buyurtma',
  awaiting_payment: 'To‘lov kutilmoqda',
  searching: 'Haydovchi qidirilmoqda',
  driver_assigned: 'Haydovchi yo‘lda',
  driver_arrived: 'Haydovchi yetib keldi',
  in_progress: 'Safarda',
  completed: 'Yakunlangan',
  cancelled: 'Bekor qilingan',
};

export const RIDE_STATUS_SHORT: Record<RideStatus, string> = {
  scheduled: 'Keyinroqqa',
  awaiting_payment: 'To‘lov kutilmoqda',
  searching: 'Qidiruv',
  driver_assigned: 'Tayinlangan',
  driver_arrived: 'Yetib keldi',
  in_progress: 'Safarda',
  completed: 'Yakunlangan',
  cancelled: 'Bekor',
};

export type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'brand';

export const RIDE_STATUS_TONE: Record<RideStatus, Tone> = {
  scheduled: 'brand',
  awaiting_payment: 'neutral',
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
  card_fare: 'Karta safari puli',
  payout: 'Pul o‘tkazildi',
  cancel_fee: 'Bekor qilish to‘lovi',
  cancel_fee_collected: 'Olingan qarz (boshqa haydovchiga)',
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
  offer_expired: 'Taklifga javob bo‘lmadi',
  dispatch_started: 'Haydovchi qidiruvi boshlandi',
  paid: 'Karta orqali to‘landi',
  refunded: 'Pul qaytarildi',
  owed_fee_added: 'Oldingi qarz qo‘shildi',
  fee_waived: 'Bekor qilish to‘lovi kechirildi',
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
  pool_joined: 'Hamroh: mashinaga yo‘lovchi qo‘shildi',
  pool_left: 'Hamroh: yo‘lovchi chiqdi',
};

export const LICENCE_STATUS: Record<LicenceStatus, string> = {
  unverified: 'Reyestrda tekshirilmagan',
  valid: 'Reyestrda tasdiqlangan',
  invalid: 'Reyestrda tasdiqlanmadi',
};

export const LICENCE_TONE: Record<LicenceStatus, Tone> = {
  unverified: 'amber',
  valid: 'green',
  invalid: 'red',
};

export const TRIP_STATUS: Record<TripStatus, string> = {
  scheduled: 'Jo‘nashni kutmoqda',
  boarding: 'Yo‘lovchilar chiqmoqda',
  departed: 'Yo‘lda',
  arrived: 'Yetib keldi',
  cancelled: 'Bekor qilingan',
};

export const TRIP_TONE: Record<TripStatus, Tone> = {
  scheduled: 'blue',
  boarding: 'amber',
  departed: 'green',
  arrived: 'neutral',
  cancelled: 'red',
};

export const BOOKING_STATUS: Record<BookingStatus, string> = {
  booked: 'Bron qilingan',
  boarded: 'Mashinada',
  completed: 'Yakunlangan',
  cancelled: 'Bekor qilingan',
  no_show: 'Kelmadi',
};

export const BOOKING_TONE: Record<BookingStatus, Tone> = {
  booked: 'blue',
  boarded: 'green',
  completed: 'neutral',
  cancelled: 'red',
  no_show: 'amber',
};

export const COMPLAINT_TYPE: Record<ComplaintType, string> = {
  lost_item: 'Mashinada narsa qoldi',
  driver_behaviour: 'Haydovchining xulqi',
  route: 'Yo‘l / manzil',
  price: 'Narx',
  car_condition: 'Mashina holati',
  safety: 'Xavfsizlik',
  other: 'Boshqa',
};

export const COMPLAINT_STATUS: Record<ComplaintStatus, string> = {
  open: 'Yangi',
  in_progress: 'Ko‘rib chiqilmoqda',
  resolved: 'Yopilgan',
};

export const COMPLAINT_TONE: Record<ComplaintStatus, Tone> = {
  open: 'red',
  in_progress: 'amber',
  resolved: 'neutral',
};

export const RESOLUTIONS: Record<ComplaintResolution, string> = {
  item_returned: 'Narsa egasiga qaytarildi',
  refund: 'Pul qaytarildi',
  driver_warned: 'Haydovchiga ogohlantirish',
  driver_blocked: 'Haydovchi bloklandi',
  rejected: 'Asossiz deb topildi',
  no_action: 'Chora ko‘rilmadi',
};

export const RECEIPT_STATUS: Record<ReceiptStatus, string> = {
  pending: 'Yuborilmoqda',
  sent: 'Yuborilgan',
  skipped: 'Saqlangan (yuborilmagan)',
};

export const RECEIPT_TONE: Record<ReceiptStatus, Tone> = {
  pending: 'amber',
  sent: 'green',
  skipped: 'neutral',
};

export const PROVIDERS: Record<string, string> = { payme: 'Payme', click: 'Click' };

/** Outbox topics (side effects) as operators read them. */
export const OUTBOX_TOPICS: Record<string, string> = {
  'ride.requested': 'Yangi buyurtma',
  'ride.status_changed': 'Buyurtma holati',
  'ride.offer_created': 'Haydovchiga taklif',
  'ride.offer_closed': 'Taklif yopildi',
  'ride.attention': 'Operatorga signal',
  'ride.sos': 'SOS',
  'driver.status_changed': 'Haydovchi holati',
  'driver.appeal': 'Haydovchi murojaati',
  'driver.licence_check_requested': 'Litsenziyani tekshirish',
  'fiscal.receipt_due': 'Fiskal chek',
  'ride.changed': 'Buyurtma o‘zgardi',
  'ride.refund_changed': 'Karta to‘lovini qaytarish',
  'driver.topup_paid': 'Balans to‘ldirildi',
  'driver.appeal_resolved': 'Murojaatga javob',
  'complaint.changed': 'Shikoyat',
  'intercity.trip_changed': 'Shaharlararo qatnov',
  'intercity.booking_changed': 'Shaharlararo bron',
};

/** Bytes as "850 KB", "2,4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** A local "YYYY-MM-DDTHH:mm" (Tashkent wall clock, as a datetime-local input shows it) → ISO. */
export function tashkentLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const t = Date.parse(`${local}:00+05:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** An instant as the Tashkent wall clock "YYYY-MM-DDTHH:mm" for a datetime-local input. */
export function isoToTashkentLocal(iso: string | number): string {
  return tashkent(iso).toISOString().slice(0, 16);
}

export const PAYMENT_STATUS: Record<string, string> = {
  pending: 'kutilmoqda',
  paid: 'to‘langan',
  not_charged: 'olinmagan',
  failed: 'o‘tmadi',
  refund_pending: 'qaytarilishi kerak',
  refunded: 'qaytarilgan',
};

export const INTENT_STATUS: Record<IntentStatus, string> = {
  pending: 'To‘lov kutilmoqda',
  paid: 'To‘langan',
  expired: 'Muddati o‘tdi',
  cancelled: 'Bekor qilingan',
  refund_pending: 'Qaytarilishi kerak',
  refunded: 'Qaytarilgan',
};

export const INTENT_TONE: Record<IntentStatus, Tone> = {
  pending: 'amber',
  paid: 'green',
  expired: 'neutral',
  cancelled: 'neutral',
  refund_pending: 'red',
  refunded: 'blue',
};

export const INTENT_PURPOSE: Record<'ride' | 'topup', string> = {
  ride: 'Safar uchun',
  topup: 'Balans to‘ldirish',
};

/** A cash ride's cancellation fee, as operators read it. */
export const FEE_STATUS: Record<FeeStatus, string> = {
  owed: 'qarz (keyingi naqd safarda olinadi)',
  collected: 'olingan',
  waived: 'kechirilgan',
};

export const FEE_TONE: Record<FeeStatus, Tone> = {
  owed: 'amber',
  collected: 'green',
  waived: 'neutral',
};

/** A reason code's label from a table (GET admin/reasons), or the text as sent. */
export function reasonText(
  table: Record<string, string> | undefined,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return table && Object.hasOwn(table, value) ? table[value]! : value;
}

/** Why a driver passed on an offer (apps/api dispatch DECLINE_REASONS). */
export const DECLINE_REASONS: Record<string, string> = {
  too_far: 'Juda uzoq',
  destination: 'Bu tomonga bormayman',
  rider_rating: 'Yo‘lovchi reytingi past',
  car_not_suitable: 'Avtomobil mos emas',
  break: 'Dam olyapman',
  other: 'Boshqa sabab',
};
