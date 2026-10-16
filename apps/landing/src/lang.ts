import { DEFAULT_LANG, dict, isHtmlKey, LANGS, type Key, type Lang, t } from './i18n';

const STORAGE_KEY = 'sff-taxi.lang';

/**
 * `?lang=ru` wins, then the visitor's saved choice, else Uzbek. The browser language is
 * deliberately not used: many phones in Uzbekistan are set to Russian while their owners
 * read Uzbek, and the ads promise an Uzbek page; the switch is one tap away.
 */
export function detectLang(search = location.search, saved = readSaved()): Lang {
  const fromQuery = new URLSearchParams(search).get('lang');
  if (isLang(fromQuery)) return fromQuery;
  if (isLang(saved)) return saved;
  return DEFAULT_LANG;
}

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: Lang = DEFAULT_LANG;
export const currentLang = () => current;

/**
 * Fills every `[data-i18n]` element (text, or HTML for `_html` keys), every
 * `[data-i18n-attr="attr:key,attr:key"]` attribute, the `<html lang>` and the language
 * switch. Elements may carry `data-i18n-vars` (JSON) for placeholders.
 */
export function applyLang(lang: Lang, root: ParentNode = document): void {
  current = lang;
  document.documentElement.lang = lang === 'uz' ? 'uz-Latn' : 'ru';
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as Key;
    if (!(key in dict)) continue;
    const vars = parseVars(el.dataset.i18nVars);
    const text = t(key, lang, vars);
    if (isHtmlKey(key)) el.innerHTML = text;
    else el.textContent = text;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of (el.dataset.i18nAttr ?? '').split(',')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key && key in dict) el.setAttribute(attr, t(key as Key, lang));
    }
  }
  // sections written out in both languages (legal texts): show one
  for (const el of root.querySelectorAll<HTMLElement>('[data-lang]')) {
    el.hidden = el.dataset.lang !== lang;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-lang-switch]')) {
    el.textContent = t('lang.switch', lang);
    el.setAttribute('aria-label', t('lang.label', lang));
  }
  document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // private mode: the choice lives for this page only
  }
  applyLang(lang);
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.set('lang', lang);
    history.replaceState(null, '', url);
  }
}

/** Wires the switch buttons and applies the detected language once. */
export function initLang(): Lang {
  const lang = detectLang();
  applyLang(lang);
  for (const el of document.querySelectorAll<HTMLElement>('[data-lang-switch]')) {
    el.addEventListener('click', () => setLang(currentLang() === 'uz' ? 'ru' : 'uz'));
  }
  return lang;
}

function parseVars(json: string | undefined): Record<string, string | number> | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as Record<string, string | number>;
  } catch {
    return undefined;
  }
}
