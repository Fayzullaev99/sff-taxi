/**
 * Complaints about a ride, lost items included (pure, unit-tested): the types a rider can
 * pick, what the statuses and outcomes mean, and whether the ride can still be complained
 * about (7 days after it ended, as the API allows).
 */
import type { ComplaintResolution, ComplaintStatus, ComplaintType } from '../api/types';
import { t } from '../i18n/dictionary';

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

/** The type's label in the current language (the API also sends `typeLabel`). */
export function complaintTypeLabel(type: ComplaintType): string {
  // "other" is also the name of a plural form, so its texts carry another key
  if (type === 'other') return t('support.complaints.types.otherType');
  return t(`support.complaints.types.${type}` as const);
}

/** What to write, per type: a placeholder that asks for the useful details. */
export function complaintHint(type: ComplaintType): string {
  if (type === 'other') return t('support.complaints.hints.otherHint');
  return t(`support.complaints.hints.${type}` as const);
}

export function complaintStatusLabel(status: ComplaintStatus): string {
  return t(`support.complaints.status.${status}` as const);
}

export function resolutionLabel(resolution: ComplaintResolution): string {
  return t(`support.complaints.resolution.${resolution}` as const);
}

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
