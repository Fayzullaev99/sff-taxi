import './styles.css';
import { loadAnalytics, track } from './analytics';
import { config, formatPhone, isLink, isPhone } from './config';
import { type Lang, t } from './i18n';
import { currentLang, initLang } from './lang';
import { playStoreLink } from './links';

export interface PageOptions {
  /** utm_campaign of the store links on this page. */
  campaign: string;
  /** A code to carry into the Play Store install referrer. */
  code?: string | null;
}

/**
 * What every page does on load: the language, the analytics hook, the store buttons
 * (`data-store`), the operator phone (`data-phone`), Telegram (`data-telegram`) and the
 * current year. Returns the language in use.
 */
export function initPage(opts: PageOptions): Lang {
  const lang = initLang();
  loadAnalytics();
  wireStoreButtons(opts);
  wirePhones();
  for (const el of document.querySelectorAll('[data-year]')) {
    el.textContent = String(new Date().getFullYear());
  }
  document.addEventListener('langchange', () => wireStoreButtons(opts));
  return lang;
}

const STORE_LINKS: Record<string, () => string> = {
  'play-rider': () => config.playRider,
  'appstore-rider': () => config.appStoreRider,
  'play-driver': () => config.playDriver,
  'appstore-driver': () => config.appStoreDriver,
};

function wireStoreButtons(opts: PageOptions): void {
  const lang = currentLang();
  for (const el of document.querySelectorAll<HTMLAnchorElement>('a[data-store]')) {
    const kind = el.dataset.store ?? '';
    const base = STORE_LINKS[kind]?.() ?? '';
    const sub = el.querySelector<HTMLElement>('.btn__sub');
    if (!isLink(base)) {
      // no store page yet: an honest "soon" instead of a dead link
      el.setAttribute('aria-disabled', 'true');
      el.removeAttribute('href');
      if (sub) sub.textContent = t('cta.soon', lang);
      continue;
    }
    el.removeAttribute('aria-disabled');
    el.href = kind.startsWith('play-')
      ? playStoreLink(base, { source: 'landing', campaign: opts.campaign, code: opts.code })
      : base;
    el.rel = 'noopener';
    if (sub)
      sub.textContent = t(kind.startsWith('play-') ? 'cta.playSub' : 'cta.appstoreSub', lang);
    if (!el.dataset.tracked) {
      el.dataset.tracked = '1';
      el.addEventListener('click', () =>
        track('store_click', { store: kind, campaign: opts.campaign }),
      );
    }
  }
}

function wirePhones(): void {
  const phone = config.supportPhone;
  const real = isPhone(phone);
  for (const el of document.querySelectorAll<HTMLElement>('[data-phone]')) {
    if (el instanceof HTMLAnchorElement) {
      el.href = real ? `tel:${phone.replace(/[\s-]/g, '')}` : '#';
      if (!real) el.setAttribute('aria-disabled', 'true');
    }
    if (el.dataset.phone !== 'keep') el.textContent = formatPhone(phone);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-phone-block]')) {
    el.hidden = !real;
  }
  const tg = config.supportTelegram.replace(/^@/, '');
  for (const el of document.querySelectorAll<HTMLAnchorElement>('a[data-telegram]')) {
    if (tg) el.href = `https://t.me/${tg}`;
    else el.hidden = true;
  }
}
