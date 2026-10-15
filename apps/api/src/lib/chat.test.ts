import { describe, expect, it } from 'vitest';
import {
  CHAT_OPEN_AFTER_MINUTES,
  chatClosesAt,
  chatPreview,
  chatWritable,
  cleanChatText,
  QUICK_REPLIES,
  quickReplyText,
} from './chat.js';

const NOW = new Date('2026-10-14T07:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('ride chat', () => {
  it('is open from the assignment through the trip and a while after it', () => {
    for (const status of ['driver_assigned', 'driver_arrived', 'in_progress']) {
      expect(chatWritable({ status, completedAt: null }, NOW)).toBe(true);
    }
    expect(chatWritable({ status: 'completed', completedAt: minutesAgo(10) }, NOW)).toBe(true);
    expect(
      chatWritable({ status: 'completed', completedAt: minutesAgo(CHAT_OPEN_AFTER_MINUTES) }, NOW),
    ).toBe(false);
    for (const status of ['searching', 'scheduled', 'awaiting_payment', 'cancelled']) {
      expect(chatWritable({ status, completedAt: null }, NOW)).toBe(false);
    }
    expect(chatClosesAt({ status: 'completed', completedAt: minutesAgo(10) })).toEqual(
      new Date(NOW.getTime() + 20 * 60_000),
    );
    expect(chatClosesAt({ status: 'in_progress', completedAt: null })).toBeNull();
  });

  it('keeps text only: control and invisible characters go, line breaks stay', () => {
    expect(cleanChatText('  Chiqyapman\u0007  ')).toBe('Chiqyapman');
    expect(cleanChatText('Podyezd​ 3,‮ kod 45')).toBe('Podyezd 3, kod 45');
    expect(cleanChatText('a\r\n\r\n\r\n\r\nb\tc   d')).toBe('a\n\nb c d');
    expect(cleanChatText('\u0000​  ')).toBeNull();
    // links are allowed (a location link from the rider)
    expect(cleanChatText('https://maps.example/x')).toBe('https://maps.example/x');
  });

  it('has separate quick replies for riders and drivers', () => {
    expect(quickReplyText('rider', 'coming_out')).toBe('Chiqyapman');
    expect(quickReplyText('rider', 'five_minutes')).toBe('5 daqiqada chiqaman');
    expect(quickReplyText('driver', 'arrived')).toBe('Yetib keldim');
    expect(quickReplyText('driver', 'coming_out')).toBeNull();
    expect(Object.values(QUICK_REPLIES.driver)).toContain('Podyezd oldidaman');
    expect(Object.values(QUICK_REPLIES.rider)).toContain('Qayerdasiz?');
  });

  it('previews the first line of a message in a push', () => {
    expect(chatPreview('Yetib keldim\noq Cobalt')).toBe('Yetib keldim');
    expect(chatPreview('x'.repeat(200))).toHaveLength(120);
  });
});
