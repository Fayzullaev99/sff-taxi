import { describe, expect, it, vi } from 'vitest';
import { apiAddressLine, chooseAddress, deviceAddressLine } from './device-address';

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

describe('the address a driver reads', () => {
  it('drops what the phone says in Russian and puts English district words in Uzbek', () => {
    expect(deviceAddressLine({ street: 'улица Увайсий', city: 'Guliston' })).toBe('Guliston');
    expect(deviceAddressLine({ name: 'M-34', district: 'Bayaut District' })).toBe(
      'M-34, Bayaut tumani',
    );
    expect(deviceAddressLine({ name: 'Гулистан' })).toBeNull();
  });

  it('reads the API address as one line, plus codes out', () => {
    expect(apiAddressLine({ title: 'Uvaysiy ko‘chasi, 12', subtitle: 'Guliston' })).toBe(
      'Uvaysiy ko‘chasi, 12, Guliston',
    );
    expect(apiAddressLine({ title: 'FQVJ+FCW', subtitle: 'Guliston' })).toBe('Guliston');
    expect(apiAddressLine({ title: 'FQVJ+FCW', subtitle: null })).toBeNull();
    expect(apiAddressLine(null)).toBeNull();
  });

  it('prefers the API, asks the phone only without it, else sends none', async () => {
    const device = vi.fn(async () => ({ street: 'улица Увайсий', city: 'Gulistan' }));
    expect(await chooseAddress({ title: 'Uvaysiy ko‘chasi', subtitle: null }, device)).toBe(
      'Uvaysiy ko‘chasi',
    );
    expect(device).not.toHaveBeenCalled();
    expect(await chooseAddress(null, device)).toBe('Gulistan');
    expect(await chooseAddress({ title: '8GRPFQVJ+FCW', subtitle: null }, device)).toBe('Gulistan');
    expect(await chooseAddress(null, async () => ({ name: 'FQVJ+FCW' }))).toBeNull();
    expect(await chooseAddress(null, async () => undefined)).toBeNull();
    expect(
      await chooseAddress(null, async () => {
        throw new Error('no geocoder');
      }),
    ).toBeNull();
  });
});
