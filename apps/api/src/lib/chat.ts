/**
 * Ride chat between the rider and the driver (docs/architecture.md §9 "Ride chat"): when it
 * is open, what a message may contain, the quick replies. Pure; the chat module does the I/O.
 */
import type { Language } from '../core/i18n/language.js';
import { translate } from '../core/i18n/translate.js';

/** Longest message, in characters (after cleaning). */
export const CHAT_MAX_LENGTH = 500;
/** After the ride completed, the chat stays writable this long (a forgotten bag), then read-only. */
export const CHAT_OPEN_AFTER_MINUTES = 30;

export type ChatRole = 'rider' | 'driver';

/** One tap answers; the key is stored with the message (texts can be reworded later). */
export const QUICK_REPLIES: Record<ChatRole, Record<string, string>> = {
  rider: {
    coming_out: 'Chiqyapman',
    five_minutes: '5 daqiqada chiqaman',
    where_are_you: 'Qayerdasiz?',
    at_entrance: 'Podyezd oldidaman',
    please_wait: 'Iltimos, biroz kuting',
    call_me: 'Menga qo‘ng‘iroq qiling',
  },
  driver: {
    arrived: 'Yetib keldim',
    at_entrance: 'Podyezd oldidaman',
    where_are_you: 'Qayerdasiz?',
    on_my_way: 'Yo‘ldaman, tez orada yetib boraman',
    traffic: 'Tirbandlik, biroz kechikaman',
    cant_find: 'Manzilni topa olmayapman, mo‘ljalni yozing',
  },
};

export interface ChatRideState {
  status: string;
  completedAt: Date | null;
}

/**
 * Whether the chat can be written now: from the driver's assignment through the trip, and a
 * short while after completion; never on a cancelled ride or one still searching.
 */
export function chatWritable(ride: ChatRideState, now: Date): boolean {
  if (['driver_assigned', 'driver_arrived', 'in_progress'].includes(ride.status)) return true;
  if (ride.status === 'completed' && ride.completedAt) {
    return now.getTime() - ride.completedAt.getTime() < CHAT_OPEN_AFTER_MINUTES * 60_000;
  }
  return false;
}

/** Until when the chat stays writable (null: while the ride is on, or already closed). */
export function chatClosesAt(ride: ChatRideState): Date | null {
  return ride.status === 'completed' && ride.completedAt
    ? new Date(ride.completedAt.getTime() + CHAT_OPEN_AFTER_MINUTES * 60_000)
    : null;
}

/**
 * The text as stored: control characters (other than line breaks) and zero-width / bidi
 * overrides removed, runs of blank lines collapsed, trimmed. Null when nothing is left.
 */
export function cleanChatText(input: string): string | null {
  const text = input
    .replace(/\r\n?/g, '\n')
    // C0/C1 controls except \n and \t; tabs become spaces
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    .replace(/\t/g, ' ')
    // zero-width characters and bidirectional overrides (spoofing, invisible messages)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? text : null;
}

/**
 * A quick reply's text in a language, or null for an unknown key. The Uzbek text is what is
 * stored with the message; each reader sees the reply in their own language by its key.
 */
export function quickReplyText(role: ChatRole, key: string, lang: Language = 'uz'): string | null {
  const uz = QUICK_REPLIES[role][key];
  return uz === undefined ? null : translate(uz, lang);
}

/** The quick replies of a role as the app lists them, in a language. */
export function quickReplies(role: ChatRole, lang: Language): { key: string; text: string }[] {
  return Object.entries(QUICK_REPLIES[role]).map(([key, text]) => ({
    key,
    text: translate(text, lang),
  }));
}

/** The push preview: the first line, at most 120 characters. */
export function chatPreview(text: string): string {
  const line = text.split('\n')[0]!;
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}
