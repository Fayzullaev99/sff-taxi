import { afterEach, describe, expect, it } from 'vitest';
import {
  createTranslator,
  getLanguage,
  interpolate,
  languageFromTag,
  pluralCategory,
  setLanguage,
  type Shape,
  subscribeLanguage,
} from './core';

const uz = {
  hello: 'Salom, {name}',
  rides: { one: '{count} ta safar', other: '{count} ta safar' },
  nested: { deep: { key: 'chuqur' } },
};
const ru: Shape<typeof uz> = {
  hello: 'Привет, {name}',
  rides: { one: '{count} поездка', few: '{count} поездки', many: '{count} поездок', other: '' },
  nested: { deep: { key: 'глубоко' } },
};
const t = createTranslator<typeof uz>({ uz, ru });

afterEach(() => setLanguage('uz'));

describe('language from the phone', () => {
  it('is Russian for Russian phones, Uzbek for everything else', () => {
    expect(languageFromTag('ru-RU')).toBe('ru');
    expect(languageFromTag('RU')).toBe('ru');
    expect(languageFromTag('uz-Latn-UZ')).toBe('uz');
    expect(languageFromTag('en-US')).toBe('uz');
    expect(languageFromTag(null)).toBe('uz');
  });
});

describe('t', () => {
  it('reads the current language, Uzbek by default', () => {
    expect(getLanguage()).toBe('uz');
    expect(t('hello', { name: 'Aziz' })).toBe('Salom, Aziz');
    setLanguage('ru');
    expect(t('hello', { name: 'Aziz' })).toBe('Привет, Aziz');
    expect(t('nested.deep.key')).toBe('глубоко');
  });

  it('takes an explicit language', () => {
    expect(t('nested.deep.key', undefined, 'ru')).toBe('глубоко');
    expect(getLanguage()).toBe('uz');
  });

  it('keeps placeholders without a value and leaves unknown keys readable', () => {
    expect(interpolate('{a} va {b}', { a: 1 })).toBe('1 va {b}');
    expect(t('nested.missing' as never)).toBe('nested.missing');
  });

  it('chooses Russian plural forms by count', () => {
    setLanguage('ru');
    expect(t('rides', { count: 1 })).toBe('1 поездка');
    expect(t('rides', { count: 3 })).toBe('3 поездки');
    expect(t('rides', { count: 5 })).toBe('5 поездок');
    expect(t('rides', { count: 11 })).toBe('11 поездок');
    expect(t('rides', { count: 21 })).toBe('21 поездка');
    expect(t('rides', { count: 102 })).toBe('102 поездки');
    expect(t('rides', { count: 114 })).toBe('114 поездок');
    setLanguage('uz');
    expect(t('rides', { count: 5 })).toBe('5 ta safar');
  });

  it('categorises counts like CLDR', () => {
    expect(pluralCategory('ru', 0)).toBe('many');
    expect(pluralCategory('ru', 1)).toBe('one');
    expect(pluralCategory('ru', 4)).toBe('few');
    expect(pluralCategory('ru', 12)).toBe('many');
    expect(pluralCategory('uz', 1)).toBe('one');
    expect(pluralCategory('uz', 2)).toBe('other');
  });

  it('tells subscribers about a switch, once per change', () => {
    let calls = 0;
    const stop = subscribeLanguage(() => calls++);
    setLanguage('ru');
    setLanguage('ru');
    setLanguage('uz');
    stop();
    setLanguage('ru');
    expect(calls).toBe(2);
  });
});
