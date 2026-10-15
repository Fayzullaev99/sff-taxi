import { describe, expect, it } from 'vitest';
import { parseAcceptLanguage, runWithLanguage } from './language.js';
import { money, tr, translate, translateTable, translateTemplate } from './translate.js';

describe('Accept-Language', () => {
  it('picks the best-weighted language we support', () => {
    expect(parseAcceptLanguage('ru')).toBe('ru');
    expect(parseAcceptLanguage('ru-RU,ru;q=0.9,en-US;q=0.8')).toBe('ru');
    expect(parseAcceptLanguage('uz-Latn-UZ')).toBe('uz');
    expect(parseAcceptLanguage('en-US,en;q=0.9,ru;q=0.5')).toBe('ru');
    expect(parseAcceptLanguage('uz;q=0.5, ru;q=0.9')).toBe('ru');
    expect(parseAcceptLanguage('ru;q=0')).toBeNull();
    expect(parseAcceptLanguage('en-US,fr')).toBeNull();
    expect(parseAcceptLanguage(undefined)).toBeNull();
    expect(parseAcceptLanguage('')).toBeNull();
  });
});

describe('translate', () => {
  it('returns Uzbek as it is', () => {
    expect(translate('Buyurtma topilmadi', 'uz')).toBe('Buyurtma topilmadi');
  });

  it('looks up an exact text', () => {
    expect(translate('Buyurtma topilmadi', 'ru')).toBe('Заказ не найден');
  });

  it('matches a rendered template by shape and carries the values over', () => {
    expect(translate('Yo‘lovchini kamida 5 daqiqa kuting', 'ru')).toBe(
      'Подождите пассажира не меньше 5 минут',
    );
    expect(translate('Kamida 3 ta belgi', 'ru')).toBe('Минимум символов: 3');
    expect(translate('Kamida 1', 'ru')).toBe('Не меньше 1');
    expect(translate('Oldindan buyurtma 30 daqiqadan 24 soatgacha oldin beriladi', 'ru')).toBe(
      'Предзаказ оформляется от 30 минут до 24 часов заранее',
    );
  });

  it('leaves an unknown text (an operator’s free text) alone', () => {
    expect(translate('Operator yozgan sabab', 'ru')).toBe('Operator yozgan sabab');
  });

  it('renders a template with values', () => {
    expect(translateTemplate('Faqat {0} ta joy qoldi', [2], 'ru')).toBe('Осталось мест: 2');
    expect(translateTemplate('Faqat {0} ta joy qoldi', [2], 'uz')).toBe('Faqat 2 ta joy qoldi');
  });

  it('tr() follows the request language', () => {
    expect(tr('Bo‘sh joy qolmadi')).toBe('Bo‘sh joy qolmadi');
    runWithLanguage('ru', () => {
      expect(tr('Bo‘sh joy qolmadi')).toBe('Свободных мест не осталось');
      expect(tr('Faqat {0} ta joy qoldi', 1)).toBe('Осталось мест: 1');
    });
  });

  it('formats money per language and translates tables', () => {
    expect(money(7000, 'uz')).toBe('7 000 so‘m');
    expect(money(1250000, 'ru')).toBe('1 250 000 сум');
    expect(translateTable({ a: 'Juda uzoq', b: 'Boshqa sabab' }, 'ru')).toEqual({
      a: 'Слишком далеко',
      b: 'Другая причина',
    });
  });
});
