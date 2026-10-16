import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/dictionary';
import { classFitText, classProblem, EMPTY_FORM, validateApplication } from './application';
import { CLASS_NAMES, classesText } from './classes';

const TODAY = '2026-09-26';
const form = {
  ...EMPTY_FORM,
  fullName: 'Aliyev Vali',
  birthDate: '05.03.1990',
  pinfl: '30503900123456',
  licenceNumber: 'AF1234567',
  licenceIssuedOn: '01.06.2015',
  licenceCardNumber: 'LK1234567',
  licenceCardExpiresOn: '31.12.2027',
  make: 'Chevrolet',
  model: 'Orlando',
  colour: 'Oq',
  plate: '20 A 123 BC',
  year: '2023',
  seats: '6',
  vehicleClass: 'minivan' as const,
  features: ['ac' as const],
};

describe('taxi classes in the application', () => {
  it('takes a 6-7 seat minivan, and a 6-seat car only as a minivan', () => {
    expect(validateApplication(form, TODAY).vehicleClass).toBeUndefined();
    expect(validateApplication(form, TODAY).seats).toBeUndefined();
    expect(validateApplication({ ...form, vehicleClass: 'economy' }, TODAY).seats).toBe(
      'Yo‘lovchi o‘rindiqlari 1 dan 4 tagacha',
    );
    expect(validateApplication({ ...form, seats: '4' }, TODAY).vehicleClass).toBe(
      'Miniven uchun haydovchidan tashqari 6–7 o‘rindiq kerak',
    );
  });

  it('asks a premium model up to 3 years old for business', () => {
    const car = { make: 'Chevrolet', model: 'Malibu 2', year: 2025, seats: 4, features: ['ac'] };
    expect(classProblem('business', car, TODAY)).toBeNull();
    expect(classProblem('business', { ...car, model: 'Cobalt' }, TODAY)).toContain('premium');
    expect(classProblem('business', { ...car, year: 2021 }, TODAY)).toBe(
      'Biznes uchun avtomobil 3 yildan eski bo‘lmasligi kerak',
    );
    expect(classProblem('comfort', { ...car, features: [] }, TODAY)).toBe(
      'Komfort uchun konditsioner kerak',
    );
  });

  it('says which classes the car fits', () => {
    expect(classFitText(form, TODAY)).toContain('Miniven');
    expect(classFitText({ ...form, model: 'Malibu', seats: '4', year: '2025' }, TODAY)).toContain(
      'Ekonom, Komfort, Biznes',
    );
    expect(classFitText({ ...form, year: '' }, TODAY)).toBe('');
  });

  it('explains the lower classes switch on the profile', () => {
    const text = classesText({
      own: 'business',
      lower: ['comfort', 'economy'],
      takesLower: false,
      rides: ['business'],
      qualifiesFor: ['economy', 'comfort', 'business'],
    });
    expect(text).toMatchObject({
      own: 'Biznes',
      rides: 'Biznes',
      toggle: 'Komfort, Ekonom buyurtmalarini ham olaman',
      toggleHint: 'Faqat Biznes buyurtmalari keladi.',
    });
    expect(text.qualifies).toContain('Ekonom, Komfort talablariga ham mos');
  });
});

describe('in Russian', () => {
  afterEach(() => setLanguage('uz'));

  it('explains the lower classes switch', () => {
    setLanguage('ru');
    expect(CLASS_NAMES.economy).toBe('Эконом');
    expect(
      classesText({
        own: 'business',
        lower: ['comfort', 'economy'],
        takesLower: false,
        rides: ['business'],
        qualifiesFor: ['business'],
      }),
    ).toMatchObject({
      own: 'Бизнес',
      toggle: 'Брать и заказы Комфорт, Эконом',
      toggleHint: 'Приходят только заказы Бизнес.',
      qualifies: 'Чтобы сменить класс, обратитесь к оператору (техосмотр).',
    });
  });
});
