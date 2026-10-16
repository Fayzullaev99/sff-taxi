import { currentLanguage, type Language } from './language.js';
import { RU } from './ru.js';

/**
 * Renders user-facing text in a language. Every message in the code is written in Uzbek
 * (Latin); the Russian catalog (./ru.ts) maps each Uzbek text, or template with `{0}`
 * placeholders, to its Russian. A text that is not in the catalog is returned as it is
 * (the catalog test fails on any message the code produces without a translation).
 */

/** "{0} ta buyurtma" + [3] → "3 ta buyurtma". */
export function render(template: string, params: readonly (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (m, i: string) =>
    Number(i) < params.length ? String(params[Number(i)]) : m,
  );
}

interface TemplateEntry {
  /** The Uzbek template as a pattern over a rendered text, capturing the values. */
  pattern: RegExp;
  /** Placeholder index of each capture group, in order. */
  indexes: number[];
  translation: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(catalog: Record<string, string>): TemplateEntry[] {
  const entries: TemplateEntry[] = [];
  for (const [template, translation] of Object.entries(catalog)) {
    if (!/\{\d+\}/.test(template)) continue;
    const indexes: number[] = [];
    const source = template
      .split(/(\{\d+\})/)
      .map((part) => {
        const m = /^\{(\d+)\}$/.exec(part);
        if (!m) return escape(part);
        indexes.push(Number(m[1]));
        return '([\\s\\S]+?)';
      })
      .join('');
    entries.push({ pattern: new RegExp(`^${source}$`), indexes, translation });
  }
  // the most specific template first: "Kamida {0} ta belgi" before "Kamida {0}"
  return entries.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
}

const catalogs: Record<Language, Record<string, string>> = { uz: {}, ru: RU };
const templates: Partial<Record<Language, TemplateEntry[]>> = {};

function templatesOf(lang: Language): TemplateEntry[] {
  return (templates[lang] ??= compile(catalogs[lang]));
}

/**
 * The translation of a rendered Uzbek text: an exact entry, else the first template whose
 * shape fits (its values carried over), else the text itself.
 */
export function translate(text: string, lang: Language): string {
  if (lang === 'uz') return text;
  const exact = catalogs[lang][text];
  if (exact !== undefined) return exact;
  for (const t of templatesOf(lang)) {
    const m = t.pattern.exec(text);
    if (!m) continue;
    const params: (string | number)[] = [];
    t.indexes.forEach((index, i) => {
      params[index] = m[i + 1]!;
    });
    return render(
      t.translation,
      params.map((p) => p ?? ''),
    );
  }
  return text;
}

/** A template with its values, in a language: the template is looked up, then rendered. */
export function translateTemplate(
  template: string,
  params: readonly (string | number)[],
  lang: Language,
): string {
  const t = lang === 'uz' ? template : (catalogs[lang][template] ?? template);
  return render(t, params);
}

/** Whether the catalog of a language has this Uzbek text or template. */
export function hasTranslation(template: string, lang: Language): boolean {
  return lang === 'uz' || catalogs[lang][template] !== undefined;
}

/**
 * Text for the person behind the current request: `tr('Faqat {0} ta joy qoldi', free)`.
 * Outside a request (the worker) it renders Uzbek; handlers that know the recipient's
 * language use `translateTemplate` with it instead.
 */
export function tr(template: string, ...params: (string | number)[]): string {
  return translateTemplate(template, params, currentLanguage());
}

/** 7000 → "7 000 so‘m" / "7 000 сум": thousands separated by spaces, as prices are written. */
export function money(n: number, lang: Language): string {
  const digits = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return lang === 'ru' ? `${digits} сум` : `${digits} so‘m`;
}

/** `money` in the language of the current request. */
export function moneyNow(n: number): string {
  return money(n, currentLanguage());
}

/** A whole table of Uzbek labels (reasons, classes) in a language. */
export function translateTable<K extends string>(
  table: Record<K, string>,
  lang: Language,
): Record<K, string> {
  if (lang === 'uz') return table;
  const out = {} as Record<K, string>;
  for (const key of Object.keys(table) as K[]) out[key] = translate(table[key], lang);
  return out;
}
