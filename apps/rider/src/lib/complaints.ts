/**
 * Complaints about a ride, lost items included (pure, unit-tested): the types a rider can
 * pick, what the statuses and outcomes mean, and whether the ride can still be complained
 * about (7 days after it ended, as the API allows).
 */
import type { ComplaintResolution, ComplaintStatus, ComplaintType } from '../api/types';

export const COMPLAINT_WINDOW_DAYS = 7;

/** The order in the form: the most common first. */
export const COMPLAINT_TYPES: readonly ComplaintType[] = [
  'lost_item',
  'driver_behaviour',
  'price',
  'route',
  'car_condition',
  'safety',
  'other',
];

/** The API's labels (it also sends `typeLabel`). */
export const COMPLAINT_TYPE_LABELS: Record<ComplaintType, string> = {
  lost_item: 'Mashinada narsa qoldi',
  driver_behaviour: 'Haydovchining xulqi',
  route: 'Yo‘l / manzil',
  price: 'Narx',
  car_condition: 'Mashina holati',
  safety: 'Xavfsizlik',
  other: 'Boshqa',
};

/** What to write, per type: a placeholder that asks for the useful details. */
export const COMPLAINT_HINTS: Record<ComplaintType, string> = {
  lost_item: 'Nima qoldi, qayerda (orqa o‘rindiq, yukxona), qanday ko‘rinishda?',
  driver_behaviour: 'Nima bo‘ldi? Qisqacha yozing.',
  route: 'Haydovchi qaysi yo‘ldan yurdi, nima noto‘g‘ri bo‘ldi?',
  price: 'Qancha so‘radi va nima uchun?',
  car_condition: 'Mashinada nima nosoz yoki iflos edi?',
  safety: 'Nima bo‘ldi? Xavf hozir ham bo‘lsa, 112 ga qo‘ng‘iroq qiling.',
  other: 'Muammoni yozing.',
};

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: 'Qabul qilindi',
  in_progress: 'Ko‘rib chiqilmoqda',
  resolved: 'Yopildi',
};

export const RESOLUTION_LABELS: Record<ComplaintResolution, string> = {
  item_returned: 'Narsangiz qaytarildi',
  refund: 'Pul qaytarildi',
  driver_warned: 'Haydovchiga ogohlantirish berildi',
  driver_blocked: 'Haydovchi bloklandi',
  rejected: 'Murojaat asossiz deb topildi',
  no_action: 'Chora ko‘rish talab etilmadi',
};

/** The API accepts 3..2000 characters. */
export const COMPLAINT_TEXT_MIN = 3;
export const COMPLAINT_TEXT_MAX = 2000;

/** Whether the ride can still be complained about: open, or ended less than 7 days ago. */
export function canComplain(
  ride: { completedAt: string | null; cancelledAt: string | null },
  now: Date,
): boolean {
  const ended = ride.completedAt ?? ride.cancelledAt;
  if (!ended) return true;
  return now.getTime() - new Date(ended).getTime() <= COMPLAINT_WINDOW_DAYS * 86_400_000;
}
