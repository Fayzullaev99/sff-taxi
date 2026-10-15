import { describe, expect, it } from 'vitest';
import {
  badgeText,
  type ChatMessage,
  chatStatusText,
  composerState,
  mergeMessages,
  messageTime,
  parseChatEvent,
  receiptText,
  withMessage,
} from './chat';

const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  rideId: 'r1',
  authorRole: 'driver',
  mine: false,
  text: id,
  quickReply: null,
  readAt: null,
  createdAt: '2026-10-14T09:05:00.000Z',
  ...over,
});

describe('ride chat', () => {
  it('reads the stream’s chat events and ignores the rest', () => {
    expect(
      parseChatEvent(
        JSON.stringify({
          type: 'chat.message',
          rideId: 'r1',
          messageId: 'm1',
          authorRole: 'driver',
        }),
      ),
    ).toEqual({ type: 'chat.message', rideId: 'r1', messageId: 'm1', authorRole: 'driver' });
    expect(
      parseChatEvent(JSON.stringify({ type: 'chat.read', rideId: 'r1', readerRole: 'driver' })),
    ).toEqual({ type: 'chat.read', rideId: 'r1', readerRole: 'driver' });
    expect(parseChatEvent(JSON.stringify({ type: 'ride.updated', rideId: 'r1' }))).toBeNull();
    expect(parseChatEvent(JSON.stringify({ type: 'chat.message', rideId: 'r1' }))).toBeNull();
    expect(parseChatEvent('not json')).toBeNull();
  });

  it('shows fetched messages in order, then the ones being sent', () => {
    const pending = msg('local-1', { mine: true, pending: true, authorRole: 'rider' });
    const merged = mergeMessages([msg('02'), msg('01')], [pending]);
    expect(merged.map((m) => m.id)).toEqual(['01', '02', 'local-1']);
    // a sent message is added once
    const c = { messages: [msg('01')] };
    expect(withMessage(withMessage(c, msg('03')), msg('03')).messages.map((m) => m.id)).toEqual([
      '01',
      '03',
    ]);
  });

  it('guards the composer and labels receipts', () => {
    expect(composerState('  ', 500)).toMatchObject({ canSend: false });
    expect(composerState('Chiqyapman', 500)).toMatchObject({ canSend: true, left: 490 });
    expect(composerState('x'.repeat(501), 500)).toMatchObject({ canSend: false, tooLong: true });
    expect(receiptText(msg('1'))).toBeNull();
    expect(receiptText(msg('1', { mine: true }))).toBe('Yuborildi');
    expect(receiptText(msg('1', { mine: true, readAt: '2026-10-14T09:06:00Z' }))).toBe('O‘qildi');
    expect(receiptText(msg('1', { mine: true, pending: true }))).toBe('Yuborilmoqda…');
    expect(receiptText(msg('1', { mine: true, failed: true }))).toMatch(/^Yuborilmadi/);
  });

  it('says when the chat closes, in Tashkent time', () => {
    expect(messageTime('2026-10-14T09:05:00.000Z')).toBe('14:05');
    expect(chatStatusText({ writable: true, closesAt: null })).toBeNull();
    expect(chatStatusText({ writable: true, closesAt: '2026-10-14T09:35:00.000Z' })).toBe(
      'Suhbat 14:35 gacha ochiq.',
    );
    expect(chatStatusText({ writable: false, closesAt: '2026-10-14T09:35:00.000Z' })).toMatch(
      /^Suhbat yopilgan/,
    );
    expect(badgeText(0)).toBeNull();
    expect(badgeText(3)).toBe('3');
    expect(badgeText(12)).toBe('9+');
  });
});
