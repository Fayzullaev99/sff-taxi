import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The languages people use the apps in. Uzbek (Latin) is the product's source language:
 * every message in the code is written in it and the operator panel stays in it. Russian
 * is rendered from the catalog (./ru.ts) for requests that ask for it.
 */
export type Language = 'uz' | 'ru';
export const LANGUAGES: readonly Language[] = ['uz', 'ru'];
export const DEFAULT_LANGUAGE: Language = 'uz';

export function isLanguage(value: unknown): value is Language {
  return value === 'uz' || value === 'ru';
}

/**
 * The language asked for by an `Accept-Language` header: the best-weighted tag we support
 * ("ru", "ru-RU;q=0.9, uz;q=0.8" → ru), or null when the header names none of ours (an old
 * app, a browser set to English). Operators' browsers send their own header, so the panel
 * sends `uz` explicitly.
 */
export function parseAcceptLanguage(header: string | string[] | undefined): Language | null {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return null;
  let best: { lang: Language; q: number; order: number } | null = null;
  raw.split(',').forEach((part, order) => {
    const [tag = '', ...params] = part.trim().split(';');
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (!isLanguage(primary)) return;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (!Number.isFinite(q) || q <= 0) return;
    if (!best || q > best.q || (q === best.q && order < best.order)) {
      best = { lang: primary, q, order };
    }
  });
  return best ? (best as { lang: Language }).lang : null;
}

interface LanguageContext {
  lang: Language;
  /** True when the request named the language itself (the header), not a stored default. */
  explicit: boolean;
}

const store = new AsyncLocalStorage<LanguageContext>();

/** Runs `fn` with the request's language in scope (an Express middleware calls this). */
export function runWithLanguage<T>(lang: Language | null, fn: () => T): T {
  return store.run({ lang: lang ?? DEFAULT_LANGUAGE, explicit: lang !== null }, fn);
}

/** The language of the request being handled; Uzbek outside a request (the worker, tests). */
export function currentLanguage(): Language {
  return store.getStore()?.lang ?? DEFAULT_LANGUAGE;
}

/** Whether the request asked for its language itself (so it is worth remembering). */
export function requestNamedLanguage(): boolean {
  return store.getStore()?.explicit ?? false;
}

/**
 * The signed-in person's saved language, applied when the request named none: an app older
 * than the language setting still gets its last known language.
 */
export function applySavedLanguage(lang: Language): void {
  const ctx = store.getStore();
  if (ctx && !ctx.explicit) ctx.lang = lang;
}
