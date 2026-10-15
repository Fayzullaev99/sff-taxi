import { useQuery } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react';
import { api } from '../api/client';
import { dateTime, som } from '../lib/format';
import { Badge } from '../ui/controls';

export interface OperatorTip {
  id: string;
  rideId: string;
  amount: number;
  method: 'cash' | 'card';
  status: 'recorded' | 'awaiting_payment' | 'paid' | 'failed' | 'refunded';
  paidAt: string | null;
  createdAt: string;
  payments: { id: string; amount: number; status: string; provider: string | null }[];
}

export const TIP_STATUS: Record<
  OperatorTip['status'],
  { label: string; tone: 'green' | 'blue' | 'amber' | 'neutral' | 'red' }
> = {
  recorded: { label: 'Naqd (qayd etilgan)', tone: 'green' },
  awaiting_payment: { label: 'To‘lov kutilmoqda', tone: 'blue' },
  paid: { label: 'Kartadan to‘landi', tone: 'green' },
  failed: { label: 'To‘lanmadi', tone: 'amber' },
  refunded: { label: 'Qaytarildi', tone: 'neutral' },
};

/** GET admin/rides/:id/tip */
export function useRideTip(rideId: string) {
  return useQuery({
    queryKey: ['ride-tip', rideId],
    queryFn: () => api<{ tip: OperatorTip | null }>(`/v1/admin/rides/${rideId}/tip`),
  });
}

/** The ride's tip in the ride detail: amount, cash or card, its payment. Nothing without one. */
export function RideTip({ rideId }: { rideId: string }) {
  const q = useRideTip(rideId);
  const tip = q.data?.tip;
  if (!tip) return null;
  const s = TIP_STATUS[tip.status];
  return (
    <div className="alert alert-ok" role="status">
      <HandCoins size={18} aria-hidden />
      <span>
        Choychaqa: <strong>{som(tip.amount)}</strong> · <Badge tone={s.tone}>{s.label}</Badge> ·{' '}
        {dateTime(tip.paidAt ?? tip.createdAt)} · haydovchiga to‘liq (komissiyasiz)
      </span>
    </div>
  );
}
