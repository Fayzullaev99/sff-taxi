import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n/dictionary';
import {
  dismissRideNotice,
  getRideNotice,
  rideNoticeText,
  showRideNotice,
  subscribeRideNotice,
  takeoverFor,
} from './shown-rides';

describe('an open ride nobody looked at yet', () => {
  it('opens on the map, only a notice elsewhere, nothing once seen', () => {
    expect(takeoverFor('r1', false, true)).toBe('open');
    expect(takeoverFor('r1', false, false)).toBe('notice');
    expect(takeoverFor('r1', true, true)).toBeNull();
    expect(takeoverFor('r1', true, false)).toBeNull();
    expect(takeoverFor(null, false, true)).toBeNull();
  });

  it('says a ride for later is searching', () => {
    expect(rideNoticeText({ scheduledFor: '2026-10-01T05:00:00Z' })).toBe(
      'Oldindan buyurtmangiz uchun haydovchi qidirilmoqda',
    );
    expect(rideNoticeText({ scheduledFor: null })).toBe('Sizda ochiq buyurtma bor');
  });

  it('keeps one notice and tells the banner', () => {
    const listener = vi.fn();
    const stop = subscribeRideNotice(listener);
    showRideNotice({ rideId: 'r1', text: 'a' });
    expect(getRideNotice()).toEqual({ rideId: 'r1', text: 'a' });
    dismissRideNotice();
    expect(getRideNotice()).toBeNull();
    dismissRideNotice();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('in Russian', () => {
  afterEach(() => setLanguage('uz'));

  it('words the notice', () => {
    setLanguage('ru');
    expect(rideNoticeText({ scheduledFor: '2026-10-01T05:00:00Z' })).toBe(
      'Ищем водителя для вашего предзаказа',
    );
    expect(rideNoticeText({ scheduledFor: null })).toBe('У вас есть активный заказ');
  });
});
