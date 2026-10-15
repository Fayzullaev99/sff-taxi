import { type QueryClient, useQuery } from '@tanstack/react-query';
import type { ChatEvent, ChatMessage, Conversation } from '../lib/chat';
import { api, useIsSignedIn } from './session';

const id = (value: string) => encodeURIComponent(value);

export const chatKeys = { conversation: (rideId: string) => ['chat', rideId] as const };

export const chatEndpoints = {
  conversation: (rideId: string) => api.request<Conversation>(`/v1/rides/${id(rideId)}/messages`),
  send: (
    rideId: string,
    body: { text: string | null; quickReply: string | null; clientMessageId: string },
  ) => api.request<ChatMessage>(`/v1/rides/${id(rideId)}/messages`, { method: 'POST', body }),
  read: (rideId: string) =>
    api.request<{ read: number }>(`/v1/rides/${id(rideId)}/messages/read`, {
      method: 'POST',
      body: {},
    }),
};

/**
 * A ride's chat. The stream's `chat.message` / `chat.read` refetch it at once; without the
 * stream it is polled (fast while the chat screen is open, slowly for the badge).
 */
export function useConversation(
  rideId: string | undefined,
  opts: { open: boolean; live: boolean },
) {
  const signedIn = useIsSignedIn();
  return useQuery({
    queryKey: chatKeys.conversation(rideId ?? ''),
    queryFn: () => chatEndpoints.conversation(rideId!),
    enabled: signedIn && Boolean(rideId),
    staleTime: 5_000,
    refetchInterval: opts.live ? 60_000 : opts.open ? 5_000 : 20_000,
  });
}

/** The stream's chat event: the conversation is fetched again (it is small). */
export function applyChatEvent(queryClient: QueryClient, event: ChatEvent): void {
  void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(event.rideId) });
}
