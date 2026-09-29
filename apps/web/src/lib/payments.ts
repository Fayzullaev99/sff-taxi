import {
  INTENT_STATUSES,
  type IntentPurpose,
  type IntentStatus,
  type IntentSummaryRow,
} from '../api/types';

export interface PurposeTotals {
  paid: { count: number; amount: number };
  byStatus: Record<IntentStatus, { count: number; amount: number }>;
}

/**
 * The summary rows (per purpose and status) as totals per purpose: every status present
 * (zero when the API sent no row), "paid" apart for the header.
 */
export function intentTotals(
  rows: readonly IntentSummaryRow[],
): Record<IntentPurpose, PurposeTotals> {
  const empty = (): PurposeTotals => ({
    paid: { count: 0, amount: 0 },
    byStatus: Object.fromEntries(
      INTENT_STATUSES.map((s) => [s, { count: 0, amount: 0 }]),
    ) as PurposeTotals['byStatus'],
  });
  const out = { ride: empty(), topup: empty(), booking: empty() };
  for (const r of rows) {
    const t = out[r.purpose];
    if (!t || !(r.status in t.byStatus)) continue;
    t.byStatus[r.status].count += r.count;
    t.byStatus[r.status].amount += r.amount;
  }
  for (const t of Object.values(out)) t.paid = t.byStatus.paid;
  return out;
}
