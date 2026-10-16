/**
 * The app's languages, without React Native (unit-tested): the typed dictionaries, the
 * current language, `t()` with `{name}` values and plural forms. Uzbek (Latin) is the
 * source language and the default; the Russian dictionary has the same keys by type, so
 * a text added to one without the other fails the typecheck.
 *
 * - Components: `const { t } = useT()` (src/i18n/index.ts) so they re-render on a switch.
 * - Plain modules (src/lib): `t()` from here reads the language at call time.
 */

/** A text with plural forms, chosen by `count`: Russian has one/few/many, Uzbek one form. */
export interface PluralForms {
  one?: string;
  few?: string;
  many?: string;
  other: string;
}

type Leaf = string | PluralForms;

/** The shape of a dictionary: the same keys, every leaf a text or plural forms. */
export type Shape<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends PluralForms
      ? PluralForms
      : T[K] extends object
        ? Shape<T[K]>
        : never;
};

/** Every dotted key of a dictionary: "order.title", "history.rides". */
export type KeyOf<T> = {
  [K in keyof T & string]: T[K] extends Leaf
    ? K
    : T[K] extends object
      ? `${K}.${KeyOf<T[K]>}`
      : never;
}[keyof T & string];

export type Language = 'uz' | 'ru';
export const LANGUAGES: readonly Language[] = ['uz', 'ru'];

/** How each language names itself (the switch in the profile). */
export const LANGUAGE_NAMES: Record<Language, string> = { uz: 'O‘zbekcha', ru: 'Русский' };

export function isLanguage(value: unknown): value is Language {
  return value === 'uz' || value === 'ru';
}

/** The app language for a device language tag: Russian phones get Russian, the rest Uzbek. */
export function languageFromTag(tag: string | null | undefined): Language {
  return tag?.toLowerCase().startsWith('ru') ? 'ru' : 'uz';
}

export type Params = Record<string, string | number> & { count?: number };

/** "{n} daq" + { n: 7 } → "7 daq"; a placeholder without a value stays as it is. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

/** The plural category of a count in a language (CLDR: ru one/few/many, uz other). */
export function pluralCategory(lang: Language, n: number): 'one' | 'few' | 'many' | 'other' {
  const abs = Math.abs(Math.round(n));
  if (lang === 'ru') {
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return 'one';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
    return 'many';
  }
  return abs === 1 ? 'one' : 'other';
}

/** The form of a plural text for a count, with `{count}` filled in. */
export function pluralize(lang: Language, forms: PluralForms, count: number, params?: Params) {
  const category = pluralCategory(lang, count);
  const text = forms[category] ?? forms.other;
  return interpolate(text, { ...params, count });
}

/**
 * The language store: one current language, listeners told on change. React binds to it
 * with `useSyncExternalStore` (src/i18n/index.ts); plain modules read it when called.
 */
let current: Language = 'uz';
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

/** Switches the language; every subscriber (screens) re-renders at once. */
export function setLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  for (const l of listeners) l();
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A translator over a set of dictionaries (one per language, the default one complete):
 * `t('order.title')`, `t('ride.eta', { minutes: 5 })`, `t('history.count', { count: 3 })`.
 */
export function createTranslator<D extends object>(dictionaries: Record<Language, Shape<D>>) {
  const lookup = (dict: object, key: string): Leaf | undefined => {
    let node: unknown = dict;
    for (const part of key.split('.')) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ||
      (typeof node === 'object' && node !== null && 'other' in node)
      ? (node as Leaf)
      : undefined;
  };
  function t(key: KeyOf<D>, params?: Params): string;
  function t(key: KeyOf<D>, params?: Params, lang?: Language): string;
  function t(key: KeyOf<D>, params?: Params, lang: Language = current): string {
    const leaf = lookup(dictionaries[lang], key) ?? lookup(dictionaries.uz, key);
    if (leaf === undefined) return key;
    if (typeof leaf === 'string') return interpolate(leaf, params);
    return pluralize(lang, leaf, params?.count ?? 0, params);
  }
  return t;
}
