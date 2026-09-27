import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  riderStoreLink,
  supportPhone,
  telegramHandle,
  telegramLink,
  updateRequired,
} from './app-config';

describe('app config', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('x', '1.0.0')).toBeNull();
  });

  it('asks for an update only below a known minimum', () => {
    expect(updateRequired('1.0.0', '1.1.0')).toBe(true);
    expect(updateRequired('1.1.0', '1.1.0')).toBe(false);
    expect(updateRequired('1.2.0', '1.1.0')).toBe(false);
    // unknown versions never lock the rider out
    expect(updateRequired(undefined, '9.0.0')).toBe(false);
    expect(updateRequired('1.0.0', 'soon')).toBe(false);
  });

  it('turns the support Telegram into a link', () => {
    expect(telegramLink('@sff_taxi')).toBe('https://t.me/sff_taxi');
    expect(telegramLink('sff_taxi')).toBe('https://t.me/sff_taxi');
    expect(telegramLink('https://t.me/sff_taxi')).toBe('https://t.me/sff_taxi');
    expect(telegramLink('t.me/sff_taxi')).toBe('https://t.me/sff_taxi');
    expect(telegramLink('not a handle!')).toBeNull();
    expect(telegramLink(null)).toBeNull();
    expect(telegramHandle('t.me/sff_taxi')).toBe('@sff_taxi');
  });

  it('prefers the API support phone over the build fallback', () => {
    expect(supportPhone('+998901112233', '+998900000000')).toBe('+998901112233');
    expect(supportPhone(null, '+998900000000')).toBe('+998900000000');
    expect(supportPhone(null, '')).toBeNull();
  });
});

describe('store links for the update screen', () => {
  it('uses the API store page for the platform', () => {
    const urls = {
      android: 'https://play.google.com/store/apps/details?id=uz.sff.taxi&hl=uz',
      ios: 'https://apps.apple.com/app/id123',
    };
    expect(riderStoreLink('android', urls)).toEqual({ primary: urls.android, fallback: null });
    expect(riderStoreLink('ios', urls)).toEqual({ primary: urls.ios, fallback: null });
  });

  it('falls back to the Play Store by package id, and to nothing on iOS', () => {
    const none = { android: null, ios: null };
    expect(riderStoreLink('android', none)).toEqual({
      primary: 'market://details?id=uz.sff.taxi',
      fallback: 'https://play.google.com/store/apps/details?id=uz.sff.taxi',
    });
    expect(riderStoreLink('android', undefined)?.primary).toBe('market://details?id=uz.sff.taxi');
    expect(riderStoreLink('ios', none)).toBeNull();
    expect(riderStoreLink('ios', { android: null, ios: 'javascript:alert(1)' })).toBeNull();
  });

  it('never forces an update without a minimum', () => {
    expect(updateRequired('1.0.0', null)).toBe(false);
  });
});
