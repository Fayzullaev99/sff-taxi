/**
 * Reason codes drivers send, with the Uzbek labels the apps and the operator panel show.
 * Codes are what is stored and sent; labels may change without touching stored data.
 */

/** Why a driver let an offer pass (the driver app's choices; free text is accepted too). */
export const DECLINE_REASONS = {
  too_far: 'Juda uzoq',
  destination: 'Bu tomonga bormayman',
  rider_rating: 'Yo‘lovchi reytingi past',
  car_not_suitable: 'Avtomobil mos emas',
  break: 'Dam olyapman',
  other: 'Boshqa sabab',
} as const;
export type DeclineReason = keyof typeof DECLINE_REASONS;

/** Why a driver gave up an assigned ride (rider_no_show ends it, the rest send it back). */
export const DRIVER_CANCEL_REASONS = {
  rider_no_show: 'Yo‘lovchi chiqmadi',
  car_problem: 'Avtomobil nosoz',
  cannot_reach: 'Manzilga yetib borolmayman',
  rider_asked: 'Yo‘lovchi bekor qilishni so‘radi',
  other: 'Boshqa sabab',
} as const;
export type DriverCancelReason = keyof typeof DRIVER_CANCEL_REASONS;

/** Why a driver was taken off a ride by the system (ride events `driver_released`). */
export const RELEASE_REASONS = {
  reassigned: 'Operator boshqa haydovchiga berdi',
} as const;

/** Every code with its label, for the panel's mapping table. */
export const REASON_LABELS = {
  decline: DECLINE_REASONS,
  driverCancel: DRIVER_CANCEL_REASONS,
  release: RELEASE_REASONS,
} as const;

/** A code's label, or the text itself (free text, or labels stored by older versions). */
export function reasonLabel(
  table: Record<string, string>,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return Object.hasOwn(table, value) ? table[value]! : value;
}
