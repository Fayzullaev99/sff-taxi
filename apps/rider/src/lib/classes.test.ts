import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/dictionary';
import type { Fare, Quote } from '../api/types';
import { classMaxPassengers, orderableClass, quoteClasses } from './fare';
import { clampPassengers, orderChoices } from './sharing';

const fare = (total: number) => ({ total }) as Fare;

describe('taxi classes on the order screen', () => {
  it('lists the classes the quote prices, with the API’s names and seats', () => {
    const quote = {
      fares: { economy: fare(7000), minivan: fare(9800) },
      classes: [
        { id: 'economy', label: 'Ekonom', description: '', examples: 'Cobalt', maxPassengers: 3 },
        { id: 'minivan', label: 'Miniven', description: '', examples: 'Orlando', maxPassengers: 6 },
      ],
    } as Pick<Quote, 'fares' | 'classes'>;
    expect(quoteClasses(quote)).toEqual([
      { id: 'economy', label: 'Ekonom', note: 'Cobalt · 3 kishigacha', maxPassengers: 3 },
      { id: 'minivan', label: 'Miniven', note: 'Orlando · 6 kishigacha', maxPassengers: 6 },
    ]);
  });

  it('falls back to its own names for an older API, in class order', () => {
    const quote = { fares: { comfort: fare(8800), economy: fare(7000) } } as Pick<
      Quote,
      'fares' | 'classes'
    >;
    expect(quoteClasses(quote).map((c) => [c.id, c.label])).toEqual([
      ['economy', 'Ekonom'],
      ['comfort', 'Komfort'],
    ]);
  });

  it('moves the choice off a class that is switched off', () => {
    const quote = { fares: { economy: fare(7000), comfort: fare(8800) } } as Pick<
      Quote,
      'fares' | 'classes'
    >;
    expect(orderableClass(quote, 'business')).toBe('economy');
    expect(orderableClass(quote, 'comfort')).toBe('comfort');
  });

  it('lets a minivan carry up to 6 people, other classes 3', () => {
    const quote = { seats: { max: 3, front: 1, rearMax: 2, byClass: { minivan: 6 } } };
    expect(classMaxPassengers(quote, 'minivan')).toBe(6);
    expect(classMaxPassengers(null, 'business')).toBe(3);
    expect(clampPassengers(5, quote, 'minivan')).toBe(5);
    expect(clampPassengers(5, quote, 'economy')).toBe(3);
    expect(clampPassengers(9, quote, 'minivan')).toBe(6);
  });

  it('never shares a business or minivan ride', () => {
    const quote = {
      pool: {
        available: true,
        discountPercent: 20,
        fullDiscountSharePercent: 60,
        cashOnly: true,
        cars: [],
      },
      womenOnly: null,
      route: null,
      seats: { max: 3, front: 1, rearMax: 2 },
    } as Pick<Quote, 'pool' | 'womenOnly' | 'route' | 'seats'>;
    const wanted = {
      passengers: 1,
      shareable: true,
      womenOnly: false,
      fareMode: 'car' as const,
      paymentMethod: 'card' as const,
    };
    expect(orderChoices(wanted, quote, 'business')).toMatchObject({
      shareable: false,
      paymentMethod: 'card',
    });
    expect(orderChoices(wanted, quote, 'economy')).toMatchObject({
      shareable: true,
      paymentMethod: 'cash',
    });
  });
});

describe('in Russian', () => {
  afterEach(() => setLanguage('uz'));

  it('names the classes the app falls back to', () => {
    setLanguage('ru');
    const quote = { fares: { comfort: fare(8800), economy: fare(7000) } } as Pick<
      Quote,
      'fares' | 'classes'
    >;
    expect(quoteClasses(quote)).toEqual([
      {
        id: 'economy',
        label: 'Эконом',
        note: 'Cobalt, Nexia, Lacetti · до 3 чел.',
        maxPassengers: 3,
      },
      {
        id: 'comfort',
        label: 'Комфорт',
        note: 'Новые и просторные автомобили · до 3 чел.',
        maxPassengers: 3,
      },
    ]);
  });
});
