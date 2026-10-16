import { beforeEach, describe, expect, it } from 'vitest';
import { applyLang, detectLang } from './lang';

describe('detectLang', () => {
  it('prefers the query, then the saved choice, else Uzbek (never the browser language)', () => {
    expect(detectLang('?lang=ru', null)).toBe('ru');
    expect(detectLang('?lang=xx', 'ru')).toBe('ru');
    expect(detectLang('', null)).toBe('uz');
    expect(detectLang('', 'nope')).toBe('uz');
    expect(detectLang('?lang=uz', 'ru')).toBe('uz');
  });
});

describe('applyLang', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <h1 data-i18n="hero.title">x</h1>
      <ul data-i18n="services.moreList_html"></ul>
      <span id="km" data-i18n="prices.upTo" data-i18n-vars='{"km":2}'></span>
      <button data-i18n-attr="aria-label:lang.label, title:nav.menu"></button>
      <button data-lang-switch></button>
      <section data-lang="uz">uz</section>
      <section data-lang="ru" hidden>ru</section>`;
  });

  it('fills texts, HTML fragments, placeholders and attributes', () => {
    applyLang('ru');
    expect(document.querySelector('h1')!.textContent).toContain('Такси Гулистана');
    expect(document.querySelector('ul')!.children.length).toBeGreaterThan(3);
    expect(document.getElementById('km')!.textContent).toBe('до 2 км');
    const btn = document.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe('Язык');
    expect(btn.getAttribute('title')).toBe('Меню');
    expect(document.documentElement.lang).toBe('ru');
    expect(document.querySelector<HTMLElement>('[data-lang-switch]')!.textContent).toBe(
      'O‘zbekcha',
    );
    expect(document.querySelector<HTMLElement>('[data-lang="uz"]')!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-lang="ru"]')!.hidden).toBe(false);
  });

  it('switches back to Uzbek', () => {
    applyLang('ru');
    applyLang('uz');
    expect(document.querySelector('h1')!.textContent).toContain('Guliston taksisi');
    expect(document.documentElement.lang).toBe('uz-Latn');
    expect(document.querySelector<HTMLElement>('[data-lang="ru"]')!.hidden).toBe(true);
  });
});
