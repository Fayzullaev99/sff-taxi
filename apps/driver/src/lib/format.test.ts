import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/dictionary';
import {
  dateInput,
  dateTime,
  distance,
  etaMinutes,
  RIDE_CLASSES,
  som,
  time,
  until,
} from './format';

afterEach(() => setLanguage('uz'));

describe('language-aware formatting', () => {
  it('is Uzbek by default', () => {
    expect(som(45_000)).toBe('45 000 so‘m');
    expect(som(-2_500)).toBe('−2 500 so‘m');
    expect(distance(850)).toBe('850 m');
    expect(distance(3_420)).toBe('3,4 km');
    expect(etaMinutes(200)).toBe('~3 daqiqa');
    expect(until('26.09 23:59')).toBe('26.09 23:59 gacha');
    expect(RIDE_CLASSES.minivan).toBe('Miniven');
  });

  it('switches to Russian, label tables included', () => {
    setLanguage('ru');
    expect(som(45_000)).toBe('45 000 сум');
    expect(distance(850)).toBe('850 м');
    expect(distance(3_420)).toBe('3,4 км');
    expect(etaMinutes(20)).toBe('~1 мин');
    expect(until('26.09 23:59')).toBe('до 26.09 23:59');
    expect(RIDE_CLASSES.economy).toBe('Эконом');
    expect(RIDE_CLASSES.cargo_m).toBe('Средний груз');
    expect(Object.keys(RIDE_CLASSES)).toHaveLength(6);
  });
});

describe('time and dateTime', () => {
  it('show Tashkent time whatever the phone zone is', () => {
    // 13:09 UTC = 18:09 Tashkent (UTC+5, no DST)
    expect(time('2026-09-27T13:09:00Z')).toBe('18:09');
    expect(dateTime('2026-09-27T13:09:00Z')).toBe('27.09 18:09');
  });

  it('roll over to the next Tashkent day', () => {
    expect(dateTime('2026-12-31T20:30:00Z')).toBe('01.01 01:30');
  });

  it('are empty for a missing or bad time', () => {
    expect(time(null)).toBe('');
    expect(dateTime(null)).toBe('');
    expect(dateTime('not a date')).toBe('');
  });
});

describe('passLabel', () => {
  it('says when a pass ends in Tashkent time', async () => {
    const { passLabel } = await import('./money');
    expect(passLabel({ kind: 'day', endsAt: '2026-09-26T18:59:00Z' })).toBe(
      'Kunlik abonement · 26.09 23:59 gacha',
    );
  });
});

describe('dateInput', () => {
  it('puts the dots in a date typed on the number pad', () => {
    expect(dateInput('01012000')).toBe('01.01.2000');
    expect(dateInput('010')).toBe('01.0');
    expect(dateInput('01.')).toBe('01');
    expect(dateInput('01.01.20001')).toBe('01.01.2000');
    expect(dateInput('')).toBe('');
  });
});
