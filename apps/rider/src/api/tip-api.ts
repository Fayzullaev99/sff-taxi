import { useQuery } from '@tanstack/react-query';
import type { TipRulesView, TipView } from '../lib/tips';
import { api, useIsSignedIn } from './session';

const id = (value: string) => encodeURIComponent(value);

export const tipKeys = { tip: (rideId: string) => ['tip', rideId] as const };

export interface RideTipState {
  tip: TipView | null;
  rules: TipRulesView;
}

export const tipEndpoints = {
  get: (rideId: string) => api.request<RideTipState>(`/v1/rides/${id(rideId)}/tip`),
  give: (rideId: string, body: { amount: number; method: 'cash' | 'card' }) =>
    api.request<TipView>(`/v1/rides/${id(rideId)}/tip`, { method: 'POST', body }),
};

/** The ride's tip and the presets; polled fast while a card tip waits for Payme/Click. */
export function useRideTip(rideId: string, enabled: boolean) {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: tipKeys.tip(rideId),
    queryFn: () => tipEndpoints.get(rideId),
    enabled: signedIn && enabled,
    staleTime: 10_000,
    refetchInterval: (q) =>
      (q.state.data as RideTipState | undefined)?.tip?.status === 'awaiting_payment'
        ? 4_000
        : false,
  });
}
