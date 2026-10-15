import { useQuery } from '@tanstack/react-query';
import type { ChatMessage, Conversation } from '../lib/chat';
import { api } from './client';

export const chatKeys = {
  /** Under ['driver']: a reconnect's catch-up refetches it too. */
  conversation: (rideId: string) => ['driver', 'chat', rideId] as const,
};

export const chatApi = {
  conversation: (rideId: string) =>
    api.get<Conversation>(`/v1/driver/rides/${encodeURIComponent(rideId)}/messages`),
  send: (
    rideId: string,
    body: { text: string | null; quickReply: string | null; clientMessageId: string },
  ) => api.post<ChatMessage>(`/v1/driver/rides/${encodeURIComponent(rideId)}/messages`, body),
  read: (rideId: string) =>
    api.post<{ read: number }>(`/v1/driver/rides/${encodeURIComponent(rideId)}/messages/read`, {}),
};

/**
 * The ride's chat with the rider. The stream's chat events refetch it; it is also polled
 * (fast while the chat is open, slowly for the badge on the ride screen).
 */
export function useConversation(rideId: string | undefined, open: boolean) {
  return useQuery({
    queryKey: chatKeys.conversation(rideId ?? ''),
    queryFn: () => chatApi.conversation(rideId!),
    enabled: Boolean(rideId),
    staleTime: 5_000,
    refetchInterval: open ? 5_000 : 20_000,
  });
}
