import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dict, isHtmlKey, t } from './i18n';

const root = join(import.meta.dirname, '..');

/** Every page of the site (the Vite inputs). */
function htmlFiles(dir = root): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'public', 'scripts', 'src'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

describe('dictionary', () => {
  it('has both languages for every key, without empty texts', () => {
    for (const [key, entry] of Object.entries(dict)) {
      expect(entry.uz.trim(), key).not.toBe('');
      expect(entry.ru.trim(), key).not.toBe('');
    }
  });

  it('uses the same placeholders in both languages', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, entry] of Object.entries(dict)) {
      expect(vars(entry.ru), key).toEqual(vars(entry.uz));
    }
  });

  it('keeps HTML out of plain keys', () => {
    for (const [key, entry] of Object.entries(dict)) {
      if (isHtmlKey(key)) continue;
      expect(entry.uz, key).not.toMatch(/<[a-z]/i);
      expect(entry.ru, key).not.toMatch(/<[a-z]/i);
    }
  });

  it('writes Uzbek in Latin script', () => {
    for (const [key, entry] of Object.entries(dict)) {
      // the switch itself names the other language ("Русский")
      if (key === 'lang.switch') continue;
      expect(entry.uz, key).not.toMatch(/[Ѐ-ӿ]/);
    }
  });

  it('fills placeholders and falls back to the key', () => {
    expect(t('prices.upTo', 'ru', { km: 2 })).toBe('до 2 км');
    expect(t('prices.upTo', 'uz', { km: 4 })).toBe('4 km gacha');
    expect(t('nope' as never, 'uz')).toBe('nope');
  });
});

describe('pages', () => {
  const files = htmlFiles();

  it('finds the pages', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it('reference only known text keys, with HTML keys as HTML', () => {
    for (const file of files) {
      const html = readFileSync(file, 'utf8');
      for (const [, key] of html.matchAll(/(?<!\{)\{\{t:([\w.]+)\}\}/g)) {
        expect(key! in dict, `${file}: ${key}`).toBe(true);
        expect(isHtmlKey(key!), `${file}: ${key} must use {{{ }}}`).toBe(false);
      }
      for (const [, key] of html.matchAll(/\{\{\{t:([\w.]+)\}\}\}/g)) {
        expect(key! in dict, `${file}: ${key}`).toBe(true);
        expect(isHtmlKey(key!), `${file}: ${key} is not an HTML key`).toBe(true);
      }
      for (const [, key] of html.matchAll(/data-i18n="([\w.]+)"/g)) {
        expect(key! in dict, `${file}: data-i18n ${key}`).toBe(true);
      }
    }
  });

  it('have the SEO essentials and a language switch', () => {
    for (const file of files) {
      const html = readFileSync(file, 'utf8');
      expect(html, file).toMatch(/<title>/);
      expect(html, file).toMatch(/name="viewport"/);
      expect(html, file).toMatch(/data-lang-switch/);
      if (!file.endsWith('404.html')) expect(html, file).toMatch(/name="description"/);
    }
  });
});
