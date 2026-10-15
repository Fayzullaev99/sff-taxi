import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { tipLine, type DriverTip } from '../lib/tips';
import { Banner } from '../ui/components';

/** GET /driver/rides/:id/tip: the ride's tip (refetched while the rider may still add one). */
export function useRideTip(rideId: string) {
  return useQuery({
    queryKey: ['driver', 'tip', rideId],
    queryFn: () =>
      api.get<{ tip: DriverTip | null }>(`/v1/driver/rides/${encodeURIComponent(rideId)}/tip`),
    refetchInterval: (q) => {
      const tip = (q.state.data as { tip: DriverTip | null } | undefined)?.tip;
      // nothing yet or a card tip on its way: the rider may be on the rating screen now
      return !tip || tip.status === 'awaiting_payment' ? 15_000 : false;
    },
  });
}

/** "Yo‘lovchi 5 000 so‘m choychaqa berdi" on the finished ride, when there is one. */
export function TipLine({ rideId }: { rideId: string }) {
  const q = useRideTip(rideId);
  const text = q.data?.tip ? tipLine(q.data.tip) : null;
  return text ? <Banner tone="success" icon="heart" text={text} /> : null;
}
