import { useQuery } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { api } from '../api/client';
import { time } from '../lib/format';
import { formatPhone } from '../lib/phone';
import { ErrorBox, Loading } from '../ui/feedback';

const LOG = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 } as const;
const LINE = { padding: '6px 10px', borderRadius: 10, maxWidth: '85%' } as const;
const RIDER_LINE = { ...LINE, background: 'var(--surface-2, #f3f4f6)' } as const;
const DRIVER_LINE = {
  ...LINE,
  justifySelf: 'end',
  background: 'var(--brand-50, #fff7d6)',
} as const;
const TEXT = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;

export interface OperatorChatMessage {
  id: string;
  authorRole: 'rider' | 'driver';
  authorId: string;
  authorName: string | null;
  authorPhone: string;
  driverId: string;
  text: string;
  quickReply: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface OperatorChat {
  rideId: string;
  writable: boolean;
  messages: OperatorChatMessage[];
}

/** GET admin/rides/:id/messages: a ride's whole chat, read-only for operators. */
export function useRideChat(rideId: string, refetchMs = 30_000) {
  return useQuery({
    queryKey: ['ride-chat', rideId],
    queryFn: () => api<OperatorChat>(`/v1/admin/rides/${rideId}/messages`),
    refetchInterval: refetchMs,
  });
}

/**
 * The rider–driver chat in the ride detail (complaints, safety): every message with who wrote
 * it and when, whether the other side read it. Operators read; they do not write in it.
 */
export function RideChat({ rideId }: { rideId: string }) {
  const chat = useRideChat(rideId);
  if (chat.error) return <ErrorBox error={chat.error} onRetry={() => void chat.refetch()} />;
  if (!chat.data) return <Loading text="Suhbat yuklanmoqda…" />;
  const { messages, writable } = chat.data;
  return (
    <section className="detail-section" aria-label="Haydovchi va yo‘lovchi suhbati">
      <h3>
        <MessagesSquare size={16} aria-hidden /> Suhbat ({messages.length})
      </h3>
      <p className="muted small">
        {writable ? 'Suhbat ochiq' : 'Suhbat yopilgan'} · faqat o‘qish uchun (shikoyat va xavfsizlik
        tekshiruvi)
      </p>
      {!messages.length ? (
        <p className="muted small">Xabar yozilmagan.</p>
      ) : (
        <ol style={LOG}>
          {messages.map((m) => (
            <li key={m.id} style={m.authorRole === 'driver' ? DRIVER_LINE : RIDER_LINE}>
              <div className="small">
                <strong>{m.authorRole === 'driver' ? 'Haydovchi' : 'Yo‘lovchi'}</strong>{' '}
                {m.authorName ?? ''} · {formatPhone(m.authorPhone)} · {time(m.createdAt)}
                {m.quickReply ? ' · tezkor javob' : ''}
                {m.readAt ? ` · o‘qildi ${time(m.readAt)}` : ''}
              </div>
              <div style={TEXT}>{m.text}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
