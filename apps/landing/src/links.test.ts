import { describe, expect, it } from 'vitest';
import {
  appDeepLink,
  codeFromLocation,
  detectPlatform,
  playStoreLink,
  tokenFromLocation,
} from './links';

describe('codeFromLocation', () => {
  it('reads and normalises the code from the invite and promo paths', () => {
    expect(codeFromLocation('/invite/abc234')).toBe('ABC234');
    expect(codeFromLocation('/promo/guliston/')).toBe('GULISTON');
    expect(codeFromLocation('/invite/ab-c 234?x=1')).toBe('ABC234');
    expect(codeFromLocation('/invite/', '?code=kuz20')).toBe('KUZ20');
  });

  it('refuses what is not a code', () => {
    expect(codeFromLocation('/invite/')).toBeNull();
    expect(codeFromLocation('/invite/ab')).toBeNull();
    expect(codeFromLocation('/invite/%3Cscript%3E')).toBeNull();
    expect(codeFromLocation('/invite/' + 'A'.repeat(21))).toBeNull();
    expect(codeFromLocation('/t/abc')).toBeNull();
  });
});

describe('tokenFromLocation', () => {
  it('reads a share token', () => {
    expect(tokenFromLocation('/t/aB3_x-9kLmNoPq')).toBe('aB3_x-9kLmNoPq');
    expect(tokenFromLocation('/t/')).toBeNull();
    expect(tokenFromLocation('/t/short')).toBeNull();
  });
});

describe('links', () => {
  it('deep-links codes into the app', () => {
    expect(appDeepLink('ABC234')).toBe('sfftaxi://invite/ABC234');
  });

  it('adds the install referrer to a Play Store link', () => {
    const url = new URL(
      playStoreLink('https://play.google.com/store/apps/details?id=uz.sff.taxi', {
        source: 'landing',
        campaign: 'referral',
        code: 'ABC234',
      }),
    );
    expect(url.searchParams.get('id')).toBe('uz.sff.taxi');
    const referrer = new URLSearchParams(url.searchParams.get('referrer') ?? '');
    expect(referrer.get('utm_source')).toBe('landing');
    expect(referrer.get('utm_campaign')).toBe('referral');
    expect(referrer.get('code')).toBe('ABC234');
  });

  it('leaves placeholders alone', () => {
    expect(playStoreLink('', { source: 'a', campaign: 'b' })).toBe('');
    expect(playStoreLink('https://REPLACE', { source: 'a', campaign: 'b' })).toBe(
      'https://REPLACE',
    );
  });

  it('detects phones', () => {
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 13; SM-A135F)')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('other');
  });
});
