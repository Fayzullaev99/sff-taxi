/**
 * Deposits for bookings made in advance ("oldindan bron faqat yo‘l haqining bir qismi
 * to‘lansa"): a seat on the trip board (and a ride for later) is held once part of the price
 * is paid by card; the rest is cash to the driver. Settings: admin/settings/booking.
 */
export interface DepositRules {
  /** Share of the price paid in advance; 0 turns deposits off. */
  deposit_percent: number;
  /** But at least this much (so'm), never more than the price. */
  deposit_min: number;
}

/**
 * The deposit for a price: 0 when deposits are off, else the share rounded up to whole
 * 1 000 so'm, at least the minimum, at most the price itself.
 */
export function depositAmount(price: number, rules: DepositRules): number {
  if (rules.deposit_percent <= 0 || price <= 0) return 0;
  const share = Math.ceil((price * rules.deposit_percent) / 100 / 1000) * 1000;
  return Math.min(price, Math.max(rules.deposit_min, share));
}
