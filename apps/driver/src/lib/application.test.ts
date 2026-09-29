import { describe, expect, it } from 'vitest';
import {
  type ApplicationForm,
  EMPTY_FORM,
  firstStepWithError,
  formFromProfile,
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
        cngInTrunk: true,
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
    // a big trunk with the gas tank in it is allowed: the API then skips luggage rides
    expect(validateApplication({ ...GOOD, features: ['big_trunk'], cng: true }, TODAY)).toEqual({});
    const e = validateApplication({ ...GOOD, vehicleClass: 'comfort', year: '2018' }, TODAY);
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

  it('keeps the gas tank answer apart from the big trunk', () => {
    const body = toApplicationBody({ ...GOOD, features: ['ac', 'big_trunk'], cng: false });
    expect(body.vehicle).toMatchObject({ features: ['ac', 'big_trunk'], cngInTrunk: false });
    const base = {
      fullName: 'A B C',
      birthDate: '1990-01-01',
      pinfl: '12345678901234',
      licence: { number: 'AF1234567', categories: ['B'], issuedOn: '2015-01-01' },
      licenceCard: { number: 'LK-1', expiresOn: '2027-12-31' },
    };
    expect(formFromProfile({ ...base, vehicle: { ...body.vehicle, cngInTrunk: true } }).cng).toBe(
      true,
    );
    expect(formFromProfile({ ...base, vehicle: body.vehicle }).cng).toBe(false);
    expect(formFromProfile({ ...base, vehicle: null }).cng).toBe(true);
  });
});

describe('cargo car application', () => {
  const DAMAS: ApplicationForm = {
    ...GOOD,
    licenceCategories: ['B'],
    service: 'cargo',
    make: 'Chevrolet',
    model: 'Damas',
    year: '2008',
    seats: '1',
    body: 'van',
    payloadKg: '550',
    grossKg: '1400',
  };

  it('accepts a Damas as a cargo car (older than a taxi may be)', () => {
    expect(validateApplication(DAMAS, TODAY)).toEqual({});
    expect(toApplicationBody(DAMAS).vehicle).toMatchObject({
      service: 'cargo',
      body: 'van',
      payloadKg: 550,
      grossKg: 1400,
      cngInTrunk: false,
    });
  });

  it('still refuses a Damas as a taxi', () => {
    expect(validateApplication({ ...DAMAS, service: 'taxi' }, TODAY).model).toMatch(/Yuk tashish/);
  });

  it('asks for the body and payload, and C above 3.5 t', () => {
    const e = validateApplication({ ...DAMAS, body: '', payloadKg: '' }, TODAY);
    expect(e.body).toBeTruthy();
    expect(e.payloadKg).toBeTruthy();
    expect(validateApplication({ ...DAMAS, grossKg: '500' }, TODAY).grossKg).toMatch(/katta/);
    const heavy = {
      ...DAMAS,
      model: 'NLR',
      body: 'truck' as const,
      payloadKg: '3000',
      grossKg: '6500',
    };
    expect(validateApplication(heavy, TODAY).licenceCategories).toMatch(/C toifali/);
    expect(validateApplication({ ...heavy, licenceCategories: ['B', 'C'] }, TODAY)).toEqual({});
    expect(validateApplication({ ...DAMAS, year: '1995' }, TODAY).year).toMatch(/25 yil/);
  });

  it('a taxi body stays as before (no cargo fields sent)', () => {
    expect(toApplicationBody(GOOD).vehicle).not.toHaveProperty('service');
  });

  it('reads a cargo car back from the profile', () => {
    const f = formFromProfile({
      fullName: 'A B C',
      birthDate: '1990-03-05',
      pinfl: '30503900123456',
      licence: { number: 'AF1234567', categories: ['B'], issuedOn: '2015-06-01' },
      licenceCard: { number: 'LK1', expiresOn: '2027-12-31' },
      vehicle: {
        make: 'Chevrolet',
        model: 'Labo',
        colour: 'Oq',
        plate: '20A123BC',
        year: 2012,
        seats: 1,
        class: 'economy',
        features: [],
        service: 'cargo',
        body: 'pickup',
        payloadKg: 550,
        grossKg: null,
      },
    });
    expect(f).toMatchObject({ service: 'cargo', body: 'pickup', payloadKg: '550', grossKg: '' });
  });
});
