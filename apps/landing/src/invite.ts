import { track } from './analytics';
import { t } from './i18n';
import { currentLang } from './lang';
import { appDeepLink, codeFromLocation, copyText, tryOpenApp } from './links';
import { initPage } from './page';

/**
 * /invite/CODE and /promo/CODE: tries the app's deep link once (phones with the app jump
 * straight to the code screen), and shows the code with the store buttons otherwise. The
 * Play Store link carries the code in the install referrer.
 */
export function initCodePage(campaign: 'referral' | 'promo'): void {
  const code = codeFromLocation(location.pathname, location.search);
  initPage({ campaign, code });

  const codeEl = document.getElementById('code');
  const invalid = document.getElementById('invalid');
  const panel = document.getElementById('code-panel');
  if (!code) {
    if (invalid) invalid.hidden = false;
    if (panel) panel.hidden = true;
    return;
  }
  if (codeEl) codeEl.textContent = code;
  document.title = `${code} · ${document.title}`;

  const deepLink = appDeepLink(code);
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-open-app]')) {
    a.href = deepLink;
    a.addEventListener('click', () => track('open_app', { campaign }));
  }
  const copy = document.getElementById('copy');
  copy?.addEventListener('click', async () => {
    if (!(await copyText(code))) return;
    copy.textContent = t('cta.copied', currentLang());
    track('code_copy', { campaign });
    window.setTimeout(() => {
      copy.textContent = t('cta.copy', currentLang());
    }, 1600);
  });

  const status = document.getElementById('status');
  if (tryOpenApp(deepLink)) {
    if (status) status.hidden = false;
    track('deeplink_attempt', { campaign });
  }
}
