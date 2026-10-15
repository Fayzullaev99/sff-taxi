import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type {
  AdminPromo,
  AdminPromoDetail,
  PromoRules,
  Referral,
  ReferralStatus,
} from './promo-types';

/** Promo codes with their use (newest first, up to 200). */
export function usePromos(q: string, active: 'all' | 'true' | 'false') {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (active !== 'all') p.set('active', active);
  const qs = p.toString();
  return useQuery({
    queryKey: ['promos', q.trim(), active],
    queryFn: () => api<AdminPromo[]>(`/v1/admin/promos${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  });
}

export function usePromo(id: string | null) {
  return useQuery({
    queryKey: ['promo', id],
    queryFn: () => api<AdminPromoDetail>(`/v1/admin/promos/${id}`),
    enabled: Boolean(id),
  });
}

export function useReferrals(status: ReferralStatus | 'all', q: string) {
  const p = new URLSearchParams();
  if (status !== 'all') p.set('status', status);
  if (q.trim()) p.set('q', q.trim());
  const qs = p.toString();
  return useQuery({
    queryKey: ['referrals', status, q.trim()],
    queryFn: () =>
      api<{ items: Referral[]; nextCursor: string | null }>(
        `/v1/admin/referrals${qs ? `?${qs}` : ''}`,
      ),
    placeholderData: (prev) => prev,
  });
}

export function usePromoRules() {
  return useQuery({
    queryKey: ['settings', 'promo'],
    queryFn: () => api<PromoRules>('/v1/admin/settings/promo'),
  });
}
