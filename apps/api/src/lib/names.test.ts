import { describe, expect, it } from 'vitest';
import { driverGivenName } from './names.js';

describe('driverGivenName', () => {
  it('shows the given name, not the surname (QA wave 4: the board said "Qodirov")', () => {
    expect(driverGivenName('Qodirov Sherzodbek Abdumalikovich')).toBe('Sherzodbek');
    expect(driverGivenName('Aliyeva Dilnoza Rustamovna')).toBe('Dilnoza');
    expect(driverGivenName('Karimov Aziz')).toBe('Aziz');
    expect(driverGivenName('Aziz Karimov')).toBe('Aziz');
    expect(driverGivenName('Toshmatov Bobur Anvar o‘g‘li')).toBe('Bobur');
    expect(driverGivenName('  Jasur  ')).toBe('Jasur');
    // nothing looks like a given name: the second word, as the form asks
    expect(driverGivenName('Rahimov Qodirov')).toBe('Qodirov');
  });
});
