import { describe, expect, it } from 'vitest';
import {
  CLASS_INFO,
  carCanServe,
  carCapacityFor,
  carClassesForRide,
  carTakes,
  classLabel,
  maxPassengers,
  rideClassesForCar,
  takesLower,
} from './ride-classes.js';
import { RIDE_CLASSES } from './tariff.js';

describe('ride classes', () => {
  it('names every class in Uzbek', () => {
    expect(RIDE_CLASSES.map((c) => CLASS_INFO[c].label)).toEqual([
      'Ekonom',
      'Komfort',
      'Miniven',
      'Biznes',
    ]);
    expect(classLabel('minivan')).toBe('Miniven');
    expect(classLabel('cargo_s')).toBe('cargo_s');
  });

  it('gives each car its own class, and lower ones by the driver’s choice', () => {
    // comfort takes economy unless the driver turned it off (as before the classes)
    expect(takesLower('comfort', null)).toBe(true);
    expect(rideClassesForCar('comfort', null)).toEqual(['comfort', 'economy']);
    expect(rideClassesForCar('comfort', false)).toEqual(['comfort']);
    // business and minivan opt in
    expect(rideClassesForCar('business', null)).toEqual(['business']);
    expect(rideClassesForCar('business', true)).toEqual(['business', 'comfort', 'economy']);
    expect(rideClassesForCar('minivan', true)).toEqual(['minivan', 'comfort', 'economy']);
    expect(rideClassesForCar('economy', true)).toEqual(['economy']);
  });

  it('never sends a ride to a lower class’s car', () => {
    expect(carTakes('economy', 'comfort', true)).toBe(false);
    expect(carTakes('comfort', 'business', true)).toBe(false);
    expect(carTakes('business', 'minivan', true)).toBe(false);
    expect(carTakes('minivan', 'business', true)).toBe(false);
    expect(carCanServe('business', 'economy')).toBe(true);
    expect(carClassesForRide('economy')).toEqual(['economy', 'comfort', 'business', 'minivan']);
    expect(carClassesForRide('minivan')).toEqual(['minivan']);
    expect(carClassesForRide('business')).toEqual(['business']);
  });

  it('carries up to 6 people in a minivan, 3 in any other car', () => {
    expect(maxPassengers('minivan')).toBe(6);
    expect(maxPassengers('business')).toBe(3);
    expect(carCapacityFor('minivan', 7)).toBe(6);
    expect(carCapacityFor('minivan', 6)).toBe(6);
    expect(carCapacityFor('comfort', 4)).toBe(3);
  });
});
