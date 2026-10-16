import { config, isLink } from './config';

/** Codes as the API stores them: upper-case letters and digits, 3-20 characters. */
export const CODE_PATTERN = /^[A-Z0-9]{3,20}$/;

/** The code from /invite/CODE or /promo/CODE (also ?code=), normalised; null when absent. */
export function codeFromLocation(pathname: string, search = ''): string | null {
  const fromPath = /^\/(?:invite|promo)\/([^/?#]+)/.exec(pathname)?.[1];
  const raw = fromPath ?? new URLSearchParams(search).get('code') ?? '';
  const code = decodeURIComponent(raw)
    .replace(/[\s-]+/g, '')
    .toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** The share-trip token from /t/TOKEN. */
export function tokenFromLocation(pathname: string): string | null {
  const token = /^\/t\/([A-Za-z0-9_-]{8,128})/.exec(pathname)?.[1];
  return token ?? null;
}

/**
 * The rider app's deep link for a code. Promo codes use the same screen as invitations:
 * the app's code box takes both (POST /promos decides which it is).
 */
export const appDeepLink = (code: string) =>
  `${config.appScheme}://invite/${encodeURIComponent(code)}`;

/**
 * Play Store link with an install referrer: the app can read it after the install
 * (Google Play Install Referrer API) to pre-fill the code; campaigns show up in the Play
 * Console as utm_source/utm_campaign.
 */
export function playStoreLink(
  base: string,
  campaign: { source: string; campaign: string; code?: string | null },
): string {
  if (!isLink(base)) return base;
  const url = new URL(base);
  const referrer = new URLSearchParams({
    utm_source: campaign.source,
    utm_medium: 'landing',
    utm_campaign: campaign.campaign,
  });
  if (campaign.code) referrer.set('code', campaign.code);
  url.searchParams.set('referrer', referrer.toString());
  return url.toString();
}

export type Platform = 'android' | 'ios' | 'other';

export function detectPlatform(ua = navigator.userAgent): Platform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'other';
}

/**
 * Tries to open the app with its scheme; on a phone without the app nothing happens (no
 * error is raised), so the page stays visible with the code and the store buttons.
 * Skipped on desktop, where the scheme would only show a browser error dialog.
 */
export function tryOpenApp(deepLink: string, platform = detectPlatform()): boolean {
  if (platform === 'other') return false;
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.src = deepLink;
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 2000);
  // iOS ignores iframe navigations to custom schemes: navigate the page itself
  if (platform === 'ios') window.setTimeout(() => location.assign(deepLink), 50);
  return true;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
