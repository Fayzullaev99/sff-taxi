/**
 * The ride chat on the rider's phone, without React Native (unit-tested): the stream's chat
 * events, merging sent and fetched messages, what the composer allows, the time labels.
 */
import { t } from '../i18n/dictionary';

export interface ChatMessage {
  id: string;
  rideId: string;
  authorRole: 'rider' | 'driver';
  mine: boolean;
  text: string;
  quickReply: string | null;
  readAt: string | null;
  createdAt: string;
  /** Sent from this phone and not confirmed by the API yet. */
  pending?: boolean;
  /** Not sent (offline, refused): the composer offers a retry. */
  failed?: boolean;
  /** The app's id for a message being sent (the retry key). */
  clientMessageId?: string;
}

export interface Conversation {
  rideId: string;
  writable: boolean;
  closesAt: string | null;
  unread: number;
  maxLength: number;
  quickReplies: { key: string; text: string }[];
  counterpart: { role: 'rider' | 'driver'; name: string | null };
  messages: ChatMessage[];
}

export type ChatEvent =
  | { type: 'chat.message'; rideId: string; messageId: string; authorRole: 'rider' | 'driver' }
  | { type: 'chat.read'; rideId: string; readerRole: 'rider' | 'driver' };

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isRole = (v: unknown): v is 'rider' | 'driver' => v === 'rider' || v === 'driver';

/** A chat event of the stream (a nudge to refetch the conversation), else null. */
export function parseChatEvent(raw: string): ChatEvent | null {
  let d: Record<string, unknown>;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    d = data as Record<string, unknown>;
  } catch {
    return null;
  }
  if (d.type === 'chat.message' && isStr(d.rideId) && isStr(d.messageId) && isRole(d.authorRole)) {
    return {
      type: 'chat.message',
      rideId: d.rideId,
      messageId: d.messageId,
      authorRole: d.authorRole,
    };
  }
  if (d.type === 'chat.read' && isStr(d.rideId) && isRole(d.readerRole)) {
    return { type: 'chat.read', rideId: d.rideId, readerRole: d.readerRole };
  }
  return null;
}

/**
 * The messages to show: the fetched ones in order (ids are time-ordered), then those still
 * being sent from this phone, or not sent. A sent message leaves the local list for the
 * fetched one, so nothing shows twice.
 */
export function mergeMessages(fetched: ChatMessage[], local: ChatMessage[]): ChatMessage[] {
  const ids = new Set(fetched.map((m) => m.id));
  const sorted = [...fetched].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...sorted, ...local.filter((m) => !ids.has(m.id))];
}

/** A conversation with a just-sent message in it (the API's answer), without duplicates. */
export function withMessage<C extends { messages: ChatMessage[] }>(c: C, m: ChatMessage): C {
  if (c.messages.some((x) => x.id === m.id)) return c;
  return { ...c, messages: mergeMessages([...c.messages, m], []) };
}

/** What the composer may send: trimmed, within the limit, not empty. */
export function composerState(text: string, maxLength: number) {
  const trimmed = text.trim();
  return {
    canSend: trimmed.length > 0 && trimmed.length <= maxLength,
    left: maxLength - trimmed.length,
    tooLong: trimmed.length > maxLength,
  };
}

/** "14:05" in Tashkent (UTC+5). */
export function messageTime(iso: string): string {
  const t = new Date(Date.parse(iso) + 5 * 3600_000);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

/** The line under the composer when it is closed, or until when it stays open. */
export function chatStatusText(c: Pick<Conversation, 'writable' | 'closesAt'>): string | null {
  if (!c.writable) return t('ride.chat.closed');
  if (c.closesAt) return t('ride.chat.openUntil', { time: messageTime(c.closesAt) });
  return null;
}

/** The badge on the chat button: "9+" above nine. */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 9 ? '9+' : String(unread);
}

/** Read receipts on my last message: "O‘qildi" / "Yuborildi" / "Yuborilmoqda…". */
export function receiptText(m: ChatMessage): string | null {
  if (!m.mine) return null;
  if (m.failed) return t('ride.chat.receipt.failed');
  if (m.pending) return t('ride.chat.receipt.sending');
  return m.readAt ? t('ride.chat.receipt.read') : t('ride.chat.receipt.sent');
}
