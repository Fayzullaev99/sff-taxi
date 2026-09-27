import { describe, expect, it } from 'vitest';
import { deviceAddressLine } from './device-address';

describe('deviceAddressLine', () => {
  it('drops a plus code the phone gives instead of a street', () => {
    expect(deviceAddressLine({ name: 'FQVJ+FCW', city: 'Gulistan' })).toBe('Gulistan');
    expect(deviceAddressLine({ name: '8GRPFQVJ+FCW', city: 'Gulistan' })).toBe('Gulistan');
  });

  it('prefers street and number, keeps district and city once', () => {
    expect(
      deviceAddressLine({
        name: 'Mustaqillik 5',
        street: 'Mustaqillik',
        streetNumber: '5',
        district: 'Markaz',
        city: 'Guliston',
      }),
    ).toBe('Mustaqillik 5, Markaz, Guliston');
    expect(deviceAddressLine({ name: 'Guliston', city: 'Guliston' })).toBe('Guliston');
    expect(deviceAddressLine({ name: 'Bozor', subregion: 'Sirdaryo' })).toBe('Bozor, Sirdaryo');
  });

  it('is null when nothing useful is left', () => {
    expect(deviceAddressLine({ name: 'FQVJ+FCW' })).toBeNull();
    expect(deviceAddressLine({})).toBeNull();
  });
});
