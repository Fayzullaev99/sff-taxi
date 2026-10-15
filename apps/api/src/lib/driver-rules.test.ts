import { describe, expect, it } from 'vitest';
import {
  checkApplicant,
  checkClassRating,
  checkVehicle,
  formatPlate,
  fullYears,
  isBusinessModel,
  isUzPlate,
  isVanType,
  normalizePlate,
  qualifyingClasses,
  tashkentDate,
} from './driver-rules.js';
import { priority } from './priority.js';

const TODAY = '2026-09-26';
const applicant = {
  birthDate: '1990-05-01',
  licenceIssuedOn: '2015-01-10',
  licenceCategories: ['B'],
  licenceCardExpiresOn: '2027-09-01',
};
const car = {
  make: 'Chevrolet',
  model: 'Cobalt',
  year: 2020,
  seats: 4,
  class: 'economy' as const,
  features: ['ac'],
};

describe('plates', () => {
  it('normalises and validates both Uzbek formats', () => {
    expect(normalizePlate('20 a 123 bc')).toBe('20A123BC');
    expect(normalizePlate('01-777-ABC')).toBe('01777ABC');
    expect(isUzPlate('20A123BC')).toBe(true);
    expect(isUzPlate('01777ABC')).toBe(true);
    expect(isUzPlate('99A123BC')).toBe(false); // no such region
    expect(isUzPlate('20A12BC')).toBe(false);
    expect(isUzPlate('A123BC20')).toBe(false);
    expect(formatPlate('20A123BC')).toBe('20 A 123 BC');
    expect(formatPlate('01777ABC')).toBe('01 777 ABC');
  });
});

describe('dates', () => {
  it('counts whole years with the birthday on its day', () => {
    expect(fullYears('2005-09-26', TODAY)).toBe(21);
    expect(fullYears('2005-09-27', TODAY)).toBe(20);
    expect(fullYears('2005-10-01', TODAY)).toBe(20);
  });

  it('knows the Tashkent date around midnight UTC', () => {
    expect(tashkentDate(new Date('2026-09-26T18:59:00Z'))).toBe('2026-09-26');
    expect(tashkentDate(new Date('2026-09-26T19:00:00Z'))).toBe('2026-09-27');
  });
});

describe('applicant (Res. 200 cl. 10)', () => {
  it('accepts a 21-year-old with 3 years of experience and a valid licence card', () => {
    expect(checkApplicant(applicant, TODAY)).toEqual([]);
    expect(
      checkApplicant(
        { ...applicant, birthDate: '2005-09-26', licenceIssuedOn: '2023-09-26' },
        TODAY,
      ),
    ).toEqual([]);
  });

  it('names every problem', () => {
    const problems = checkApplicant(
      {
        birthDate: '2005-09-27',
        licenceIssuedOn: '2024-01-01',
        licenceCategories: ['A'],
        licenceCardExpiresOn: '2026-09-25',
      },
      TODAY,
    );
    expect(problems.map((p) => p.path)).toEqual([
      'birthDate',
      'licenceIssuedOn',
      'licenceCategories',
      'licenceCardExpiresOn',
    ]);
    expect(problems[0]!.message).toMatch(/21 yosh/);
  });
});

describe('vehicle', () => {
  it('accepts a normal city car', () => {
    expect(checkVehicle(car, TODAY)).toEqual([]);
    expect(checkVehicle({ ...car, year: 2011 }, TODAY)).toEqual([]);
  });

  it('refuses vans, old cars and too many seats', () => {
    expect(isVanType('Chevrolet', 'Damas')).toBe(true);
    expect(isVanType('Daewoo', 'Labo')).toBe(true);
    expect(isVanType('Chevrolet', 'Nexia 3')).toBe(false);
    const problems = checkVehicle({ ...car, model: 'Damas', year: 2010, seats: 6 }, TODAY);
    expect(problems.map((p) => p.path)).toEqual(['vehicle.model', 'vehicle.year', 'vehicle.seats']);
  });

  it('keeps Comfort for cars up to 5 years old with air conditioning', () => {
    expect(checkVehicle({ ...car, class: 'comfort', year: 2021 }, TODAY)).toEqual([]);
    expect(checkVehicle({ ...car, class: 'comfort', year: 2020 }, TODAY)).toHaveLength(1);
    expect(checkVehicle({ ...car, class: 'comfort', year: 2024, features: [] }, TODAY)).toEqual([
      { path: 'vehicle.class', message: 'Komfort uchun konditsioner kerak' },
    ]);
  });
});

describe('priority score', () => {
  const fresh = {
    offersReceived: 0,
    offersAccepted: 0,
    ridesCancelled: 0,
    ratingSum: 0,
    ratingCount: 0,
  };

  it('starts a new driver high but not at the top', () => {
    expect(priority(fresh)).toEqual({
      score: 91,
      acceptance: 0.8,
      reliability: 1,
      rating: 0.95,
      stars: 4.8,
    });
  });

  it('falls with missed offers, cancellations and low ratings, and rises with good work', () => {
    const missing = priority({ ...fresh, offersReceived: 20, offersAccepted: 5 });
    const cancelling = priority({
      ...fresh,
      offersReceived: 20,
      offersAccepted: 20,
      ridesCancelled: 10,
    });
    const rated = priority({ ...fresh, ratingSum: 20 * 3, ratingCount: 20 });
    const great = priority({
      ...fresh,
      offersReceived: 50,
      offersAccepted: 50,
      ratingSum: 250,
      ratingCount: 50,
    });
    expect(missing.score).toBeLessThan(80);
    expect(cancelling.reliability).toBeCloseTo(0.667, 3);
    expect(cancelling.score).toBeLessThan(91);
    expect(rated.stars).toBe(3.4);
    expect(rated.score).toBeLessThan(85);
    expect(great.score).toBeGreaterThan(97);
    expect(great.score).toBeLessThanOrEqual(100);
  });
});

describe('minivan and business cars', () => {
  const minivan = {
    make: 'Chevrolet',
    model: 'Orlando',
    year: 2022,
    seats: 6,
    class: 'minivan' as const,
    features: ['ac', 'big_trunk'],
  };
  const business = {
    make: 'Chevrolet',
    model: 'Malibu 2',
    year: 2025,
    seats: 4,
    class: 'business' as const,
    features: ['ac'],
  };

  it('takes a 6-7 seat minivan up to 8 years old with AC', () => {
    expect(checkVehicle(minivan, TODAY)).toEqual([]);
    expect(checkVehicle({ ...minivan, model: 'Carnival', make: 'Kia', seats: 7 }, TODAY)).toEqual(
      [],
    );
    expect(checkVehicle({ ...minivan, seats: 4 }, TODAY)[0]?.path).toBe('vehicle.seats');
    expect(checkVehicle({ ...minivan, seats: 8 }, TODAY)[0]?.path).toBe('vehicle.seats');
    expect(checkVehicle({ ...minivan, year: 2017 }, TODAY).map((p) => p.message)).toEqual([
      'Miniven uchun avtomobil 8 yildan eski bo‘lmasligi kerak',
    ]);
    expect(checkVehicle({ ...minivan, features: [] }, TODAY)[0]?.message).toBe(
      'Miniven uchun konditsioner kerak',
    );
    // a 6-seat car is a minivan or nothing: economy keeps the sedan's 4 seats
    expect(checkVehicle({ ...minivan, class: 'economy' }, TODAY)[0]?.path).toBe('vehicle.seats');
  });

  it('never makes a Damas a minivan taxi', () => {
    expect(
      checkVehicle({ ...minivan, make: 'Chevrolet', model: 'Damas', seats: 6 }, TODAY)[0]?.path,
    ).toBe('vehicle.model');
  });

  it('takes a premium model up to 3 years old with AC as business', () => {
    expect(checkVehicle(business, TODAY)).toEqual([]);
    for (const [make, model] of [
      ['Chevrolet', 'Tracker 2 Premier'],
      ['Chevrolet', 'Tahoe'],
      ['Kia', 'K5'],
      ['Hyundai', 'Sonata'],
      ['BYD', 'Han'],
      ['Mercedes-Benz', 'E 200'],
    ]) {
      expect(isBusinessModel(make!, model!)).toBe(true);
    }
    expect(isBusinessModel('Chevrolet', 'Cobalt')).toBe(false);
    expect(checkVehicle({ ...business, model: 'Cobalt' }, TODAY)[0]?.path).toBe('vehicle.class');
    expect(checkVehicle({ ...business, year: 2022 }, TODAY)[0]?.message).toBe(
      'Biznes uchun avtomobil 3 yildan eski bo‘lmasligi kerak',
    );
    expect(checkVehicle({ ...business, features: [] }, TODAY)).toHaveLength(1);
  });

  it('needs a 4.8 rating for business (a new driver starts there)', () => {
    expect(checkClassRating('business', 4.8)).toEqual([]);
    expect(checkClassRating('business', 4.7)[0]?.message).toContain('4.8');
    expect(checkClassRating('comfort', 3)).toEqual([]);
    expect(priority({ ...counts(0, 0, 0), ratingSum: 0, ratingCount: 0 }).stars).toBe(4.8);
  });

  it('lists the classes a car qualifies for', () => {
    expect(qualifyingClasses(business, TODAY)).toEqual(['economy', 'comfort', 'business']);
    expect(qualifyingClasses(minivan, TODAY)).toEqual(['minivan']);
    expect(qualifyingClasses({ ...car, year: 2016, features: [] }, TODAY)).toEqual(['economy']);
    expect(qualifyingClasses({ ...car, service: 'cargo' }, TODAY)).toEqual([]);
  });
});

function counts(received: number, accepted: number, cancelled: number) {
  return { offersReceived: received, offersAccepted: accepted, ridesCancelled: cancelled };
}
