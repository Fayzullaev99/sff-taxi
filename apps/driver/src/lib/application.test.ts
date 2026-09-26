import { describe, expect, it } from 'vitest';
import {
  type ApplicationForm,
  EMPTY_FORM,
  firstStepWithError,
  formFromProfile,
  isPhotoUrl,
  parseDate,
  toApplicationBody,
  validateApplication,
} from './application';
import { formatPlate, isUzPlate, normalizePlate, plateProblem } from './plate';

const TODAY = '2026-09-26';

const GOOD: ApplicationForm = {
  ...EMPTY_FORM,
  fullName: '  Aliyev   Vali Karimovich ',
  birthDate: '05.03.1990',
  pinfl: '3050 3900 1234 56',
  licenceNumber: 'af 1234567',
  licenceCategories: ['B', 'C'],
  licenceIssuedOn: '01.06.2015',
  licenceCardNumber: 'lk 12345-67',
  licenceCardExpiresOn: '31.12.2027',
  make: 'Chevrolet',
  model: 'Cobalt',
  colour: 'Oq',
  plate: '20 a 123 bc',
  year: '2019',
  seats: '4',
  vehicleClass: 'economy',
  features: ['ac'],
  cng: true,
};

describe('parseDate', () => {
  it('reads DD.MM.YYYY and refuses impossible dates', () => {
    expect(parseDate('05.03.1990')).toBe('1990-03-05');
    expect(parseDate('5/3/1990')).toBe('1990-03-05');
    expect(parseDate('31.02.2020')).toBeNull();
    expect(parseDate('1990-03-05')).toBeNull();
  });
});

describe('validateApplication', () => {
  it('accepts a complete application and builds the API body', () => {
    expect(validateApplication(GOOD, TODAY)).toEqual({});
    expect(toApplicationBody(GOOD)).toEqual({
      fullName: 'Aliyev Vali Karimovich',
      birthDate: '1990-03-05',
      pinfl: '30503900123456',
      licenceNumber: 'AF1234567',
      licenceCategories: ['B', 'C'],
      licenceIssuedOn: '2015-06-01',
      licenceCardNumber: 'LK12345-67',
      licenceCardExpiresOn: '2027-12-31',
      vehicle: {
        make: 'Chevrolet',
        model: 'Cobalt',
        colour: 'Oq',
        plate: '20A123BC',
        year: 2019,
        seats: 4,
        class: 'economy',
        features: ['ac'],
      },
    });
  });

  it('applies the Resolution 200 rules', () => {
    const e = validateApplication(
      {
        ...GOOD,
        birthDate: '27.09.2005', // 20 years old until tomorrow
        licenceIssuedOn: '01.01.2024',
        licenceCategories: ['A'],
        licenceCardExpiresOn: '25.09.2026',
        model: 'Damas',
        year: '2010',
        seats: '7',
      },
      TODAY,
    );
    expect(e.birthDate).toMatch(/21 yosh/);
    expect(e.licenceIssuedOn).toMatch(/3 yil/);
    expect(e.licenceCategories).toMatch(/B toifali/);
    expect(e.licenceCardExpiresOn).toMatch(/muddati o‘tgan/);
    expect(e.model).toMatch(/Furgon/);
    expect(e.year).toMatch(/15 yil/);
    expect(e.seats).toBeDefined();
    expect(firstStepWithError(e)).toBe(0);
  });

  it('checks comfort cars and the gas tank in the trunk', () => {
    expect(
      validateApplication({ ...GOOD, vehicleClass: 'comfort', year: '2018' }, TODAY).vehicleClass,
    ).toMatch(/5 yil/);
    expect(
      validateApplication({ ...GOOD, vehicleClass: 'comfort', year: '2024', features: [] }, TODAY)
        .vehicleClass,
    ).toMatch(/konditsioner/);
    const e = validateApplication({ ...GOOD, features: ['big_trunk'], cng: true }, TODAY);
    expect(e.features).toMatch(/gaz ballon/);
    expect(firstStepWithError(e)).toBe(2);
  });

  it('points at a bad PINFL, licence and plate', () => {
    const e = validateApplication(
      { ...GOOD, pinfl: '123', licenceNumber: 'A123', plate: '21 A 123 BC' },
      TODAY,
    );
    expect(e.pinfl).toMatch(/14/);
    expect(e.licenceNumber).toMatch(/AF1234567/);
    expect(e.plate).toMatch(/viloyat kodi/);
  });
});

describe('plates', () => {
  it('accepts both current formats with real regions', () => {
    expect(normalizePlate('20-a-123-bc')).toBe('20A123BC');
    expect(isUzPlate('20A123BC')).toBe(true);
    expect(isUzPlate('01123ABC')).toBe(true);
    expect(isUzPlate('21A123BC')).toBe(false);
    expect(formatPlate('20A123BC')).toBe('20 A 123 BC');
    expect(formatPlate('01123ABC')).toBe('01 123 ABC');
    expect(plateProblem('20 A 12 BC')).toMatch(/Masalan/);
    expect(plateProblem('')).toMatch(/kiriting/);
    expect(plateProblem('20 A 123 BC')).toBeNull();
  });
});

describe('formFromProfile', () => {
  it('round-trips what the API returns', () => {
    const body = toApplicationBody(GOOD);
    const form = formFromProfile({
      fullName: body.fullName,
      birthDate: body.birthDate,
      pinfl: body.pinfl,
      licence: {
        number: body.licenceNumber,
        categories: body.licenceCategories,
        issuedOn: body.licenceIssuedOn,
      },
      licenceCard: { number: body.licenceCardNumber, expiresOn: body.licenceCardExpiresOn },
      vehicle: body.vehicle,
    });
    expect(toApplicationBody(form)).toEqual(body);
    expect(validateApplication(form, TODAY)).toEqual({});
  });
});

describe('isPhotoUrl', () => {
  it('accepts http(s) links only', () => {
    expect(isPhotoUrl('https://files.sff.uz/d/abc.jpg')).toBe(true);
    expect(isPhotoUrl(' http://10.0.2.2:3200/x.png ')).toBe(true);
    expect(isPhotoUrl('file:///sdcard/a.jpg')).toBe(false);
    expect(isPhotoUrl('rasm')).toBe(false);
  });
});
