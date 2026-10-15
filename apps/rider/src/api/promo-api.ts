import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AddedCode, CreditsPage, PromoWallet } from './promo-types';
import { api, useIsSignedIn } from './session';

const id = (value: string) => encodeURIComponent(value);

export const promoKeys = {
  wallet: ['promo-wallet'] as const,
  credits: ['promo-credits'] as const,
};

export const promoEndpoints = {
  /** `deviceId`: this install (a code entered from it later is the rider's own). */
  wallet: (deviceId: string | null) =>
    api.request<PromoWallet>('/v1/promos', { query: { deviceId } }),
  /** A promo code (saved to the wallet) or a friend's invitation code. */
  add: (code: string, deviceId: string | null) =>
    api.request<AddedCode>('/v1/promos', { method: 'POST', body: { code, deviceId } }),
  remove: (promoId: string) =>
    api.request<PromoWallet>(`/v1/promos/${id(promoId)}`, { method: 'DELETE' }),
  credits: (cursor?: string) =>
    api.request<CreditsPage>('/v1/promos/credits', { query: { cursor } }),
};

export function useWallet(deviceId: string | null) {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: promoKeys.wallet,
    queryFn: () => promoEndpoints.wallet(deviceId),
    enabled: signedIn,
    staleTime: 30_000,
  });
}

export function useCredits(enabled: boolean) {
  const signedIn = useIsSignedIn();
  return useInfiniteQuery({
    queryKey: promoKeys.credits,
    queryFn: ({ pageParam }) => promoEndpoints.credits(pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: signedIn && enabled,
  });
}
