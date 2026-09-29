import { describe, expect, it } from 'vitest';
import {
  driverGivenName,
  firstName,
  formatClock,
  formatDateTime,
  formatDay,
  formatDelta,
  formatDistance,
  formatLocalPhoneInput,
  formatMinutes,
  formatMoney,
  formatPhone,
  formatTime,
  normalizePhone,
  placeLine,
  tashkentDay,
} from './format';

const s = (text: string) => text.replace(/\u00a0/g, ' ');

describe('format', () => {
  it('formats money with thin groups', () => {
    expect(s(formatMoney(45_000))).toBe('45 000 so‘m');
    expect(s(formatMoney(1_250_500))).toBe('1 250 500 so‘m');
    expect(s(formatMoney(0))).toBe('0 so‘m');
    expect(s(formatDelta(3_000))).toBe('+3 000 so‘m');
    expect(formatDelta(0)).toBe('');
  });

  it('formats distances and durations', () => {
    expect(s(formatDistance(430))).toBe('430 m');
    expect(s(formatDistance(2_450))).toBe('2,5 km');
    expect(s(formatDistance(12_300))).toBe('12 km');
    expect(s(formatMinutes(0.2))).toBe('1 daq');
    expect(s(formatMinutes(14))).toBe('14 daq');
    expect(s(formatMinutes(65))).toBe('1 soat 5 daq');
    expect(s(formatMinutes(120))).toBe('2 soat');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('shows Tashkent time', () => {
    expect(formatTime('2026-03-03T09:05:00Z')).toBe('14:05');
    const now = new Date('2026-03-03T12:00:00Z');
    expect(formatDateTime('2026-03-03T09:05:00Z', now)).toBe('Bugun, 14:05');
    expect(formatDateTime('2026-03-02T09:05:00Z', now)).toBe('Kecha, 14:05');
    expect(formatDateTime('2026-03-04T02:30:00Z', now)).toBe('Ertaga, 07:30');
    // 20:00 UTC is already the next day in Tashkent
    expect(tashkentDay(new Date('2026-03-03T20:00:00Z'))).toBe('2026-03-04');
    expect(formatDay('2026-03-04')).toBe('4 mart');
    expect(formatDateTime('2026-01-10T20:00:00Z', now)).toBe('11 yanvar, 01:00');
  });

  it('normalises and formats phones', () => {
    expect(normalizePhone('90 123 45 67')).toBe('+998901234567');
    expect(normalizePhone('+998 (90) 123-45-67')).toBe('+998901234567');
    expect(normalizePhone('12345')).toBeNull();
    expect(formatPhone('+998901234567')).toBe('+998 90 123 45 67');
    expect(formatLocalPhoneInput('901234567999')).toBe('90 123 45 67');
  });

  it('names places and people', () => {
    expect(placeLine({ address: 'Mustaqillik 12', landmark: 'Bozor', lat: 1, lng: 2 })).toBe(
      'Mustaqillik 12',
    );
    expect(placeLine({ address: null, landmark: 'Bozor oldi', lat: 1, lng: 2 })).toBe('Bozor oldi');
    expect(placeLine({ address: null, landmark: null, lat: 40.5, lng: 68.78 })).toBe(
      '40.50000, 68.78000',
    );
    expect(firstName('  Aziz Karimov ')).toBe('Aziz');
    expect(firstName(null)).toBeNull();
  });

  it('addresses a driver by the given name (surname first)', () => {
    expect(driverGivenName('Qodirov Sherzodbek Abdumalikovich')).toBe('Sherzodbek');
    expect(driverGivenName(' Aliyev  Vali ')).toBe('Vali');
    expect(driverGivenName('Sherzod')).toBe('Sherzod');
    expect(driverGivenName('Aziz Karimov')).toBe('Aziz');
    expect(driverGivenName('Toshmatov Bobur Anvar o‘g‘li')).toBe('Bobur');
    expect(driverGivenName('')).toBeNull();
    expect(driverGivenName(null)).toBeNull();
  });
});
