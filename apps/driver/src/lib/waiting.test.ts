import { describe, expect, it } from 'vitest';
import { DEFAULT_WAITING, rulesFromTariff, waitingState } from './waiting';

const ARRIVED = '2026-09-26T10:00:00.000Z';
const at = (s: number) => Date.parse(ARRIVED) + s * 1000;

describe('waitingState', () => {
  it('counts the free minutes down first', () => {
    expect(waitingState(ARRIVED, at(30), DEFAULT_WAITING)).toMatchObject({
      elapsedS: 30,
      freeLeftS: 90,
      paid: false,
      paidMinutes: 0,
      fee: 0,
      canNoShow: false,
      noShowInS: 270,
    });
  });

  it('charges every started minute after the free ones, like the API', () => {
    expect(waitingState(ARRIVED, at(120), DEFAULT_WAITING)).toMatchObject({ paid: false, fee: 0 });
    expect(waitingState(ARRIVED, at(121), DEFAULT_WAITING)).toMatchObject({
      paid: true,
      paidMinutes: 1,
      fee: 500,
      freeLeftS: 0,
    });
    expect(waitingState(ARRIVED, at(180), DEFAULT_WAITING).fee).toBe(500);
    expect(waitingState(ARRIVED, at(181), DEFAULT_WAITING).fee).toBe(1000);
  });

  it('allows a no-show only after the wait', () => {
    expect(waitingState(ARRIVED, at(299), DEFAULT_WAITING)).toMatchObject({
      canNoShow: false,
      noShowInS: 1,
    });
    expect(waitingState(ARRIVED, at(300), DEFAULT_WAITING)).toMatchObject({
      canNoShow: true,
      noShowInS: 0,
    });
  });

  it('does not go negative when the phone clock is behind', () => {
    expect(waitingState(ARRIVED, at(-50), DEFAULT_WAITING)).toMatchObject({
      elapsedS: 0,
      freeLeftS: 120,
      fee: 0,
    });
  });
});

describe('rulesFromTariff', () => {
  it('takes the published waiting rules and keeps the rest', () => {
    expect(rulesFromTariff({ waiting: { free_minutes: 3, per_minute: 700 } })).toEqual({
      freeMinutes: 3,
      perMinute: 700,
      noShowAfterMinutes: 5,
    });
    expect(rulesFromTariff(null)).toEqual(DEFAULT_WAITING);
    expect(rulesFromTariff({ waiting: { free_minutes: 'x' } })).toEqual(DEFAULT_WAITING);
  });
});
