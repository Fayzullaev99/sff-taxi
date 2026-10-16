import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/dictionary';
import type { Fare, RideStop } from '../api/types';
import { parseRealtimeEvent } from '../api/realtime-logic';
import { MAX_STOPS, withStop } from '../trip/draft';
import { getStopEdit, removeEditStop, setEditStop, startStopEdit } from '../trip/stop-edit';
import { fareLines, stopRulesText, stopStateText } from './fare';
import { etaFor } from './ride-state';
import { lockedStopCount, nextStopIndex, priceChangeText, tripTarget } from './stops';

const s = (text: string) => text.replace(/\u00a0/g, ' ');
const point = (address: string) => ({ lat: 40.5, lng: 68.78, address });

const rideStop = (lat: number, state: Partial<RideStop> = {}): RideStop => ({
  address: null,
  landmark: null,
  lat,
  lng: 68.78,
  arrivedAt: null,
  leftAt: null,
  waitingFee: 0,
  ...state,
});
const at = { arrivedAt: '2026-10-16T08:00:00Z' };
const passed = { ...at, leftAt: '2026-10-16T08:04:00Z', waitingFee: 500 };
const dropoff = { lat: 40.9, lng: 68.9, address: 'Vokzal', landmark: null };

describe('the next stop on the trip', () => {
  it('is the first unvisited stop, the one the car stands at, then the drop-off', () => {
    expect(nextStopIndex(undefined)).toBeNull();
    expect(nextStopIndex([])).toBeNull();
    expect(nextStopIndex([rideStop(1), rideStop(2)])).toBe(0);
    expect(nextStopIndex([rideStop(1, at), rideStop(2)])).toBe(0);
    expect(nextStopIndex([rideStop(1, passed), rideStop(2)])).toBe(1);
    expect(nextStopIndex([rideStop(1, passed), rideStop(2, passed)])).toBeNull();
    // a skipped stop is behind once a later one was reached
    expect(nextStopIndex([rideStop(1), rideStop(2, at)])).toBe(1);
    expect(lockedStopCount([rideStop(1, passed), rideStop(2)])).toBe(1);
    expect(lockedStopCount([rideStop(1), rideStop(2, at)])).toBe(2);
    expect(lockedStopCount(undefined)).toBe(0);
  });

  it('is where the ETA and the map point: the API\u2019s index first, else derived', () => {
    const stops = [rideStop(40.1, passed), rideStop(40.2)];
    expect(tripTarget({ stops, dropoff })).toEqual({
      point: { lat: 40.2, lng: 68.78 },
      stopIndex: 1,
    });
    expect(tripTarget({ stops, dropoff, nextStopIndex: null })).toEqual({
      point: dropoff,
      stopIndex: null,
    });
    expect(tripTarget({ stops, dropoff, nextStopIndex: 0 }).stopIndex).toBe(0);
    expect(tripTarget({ stops: [], dropoff, nextStopIndex: undefined }).stopIndex).toBeNull();
  });

  it('takes a stream ETA only for the stop the screen heads to', () => {
    const reading = { etaS: 120, at: '2026-10-16T08:00:00Z' };
    expect(etaFor(reading, 1)).toBe(reading);
    expect(etaFor({ ...reading, stopIndex: 1 }, 1)).toEqual({ ...reading, stopIndex: 1 });
    expect(etaFor({ ...reading, stopIndex: 0 }, 1)).toBeNull();
    expect(etaFor({ ...reading, stopIndex: null }, 1)).toBeNull();
    expect(etaFor({ ...reading, stopIndex: null }, null)).not.toBeNull();
    expect(etaFor(null, 0)).toBeNull();
    const event = parseRealtimeEvent(
      '{"type":"driver.location","rideId":"r1","lat":40.5,"lng":68.8,"heading":90,"at":"2026-10-16T08:00:00Z","etaS":null,"destinationEtaS":300,"nextStopIndex":1}',
    );
    expect(event).toMatchObject({ destinationEtaS: 300, nextStopIndex: 1 });
    const older = parseRealtimeEvent(
      '{"type":"driver.location","rideId":"r1","lat":40.5,"lng":68.8,"at":"2026-10-16T08:00:00Z","etaS":null,"destinationEtaS":300}',
    );
    expect(older && 'nextStopIndex' in older).toBe(false);
  });
});

describe('editing the stops of a ride', () => {
  it('starts from the ride\u2019s stops, sets, adds and removes, never more than two', () => {
    startStopEdit('r1', [rideStop(40.1, { address: 'Dorixona' })]);
    expect(getStopEdit()).toEqual({
      rideId: 'r1',
      stops: [{ lat: 40.1, lng: 68.78, address: 'Dorixona' }],
    });
    setEditStop(1, { lat: 40.2, lng: 68.79, address: 'Maktab' });
    setEditStop(2, { lat: 40.3, lng: 68.79, address: 'Uchinchi' });
    expect(getStopEdit().stops.map((s) => s.address)).toEqual(['Dorixona', 'Maktab']);
    setEditStop(0, { lat: 40.5, lng: 68.79, address: 'Bozor' });
    removeEditStop(1);
    expect(getStopEdit().stops.map((s) => s.address)).toEqual(['Bozor']);
    startStopEdit('r2', undefined);
    expect(getStopEdit()).toEqual({ rideId: 'r2', stops: [] });
  });

  it('says the price change in one sentence', () => {
    expect(s(priceChangeText(12_000, 14_000))).toBe(
      'Yangi narx 14 000 so\u2018m (avval 12 000 so\u2018m): +2 000 so\u2018m',
    );
    expect(s(priceChangeText(12_000, 9_500))).toBe(
      'Yangi narx 9 500 so\u2018m (avval 12 000 so\u2018m): \u22122 500 so\u2018m',
    );
    expect(s(priceChangeText(7_000, 7_000))).toBe('Narx o\u2018zgarmaydi: 7 000 so\u2018m');
  });
});

describe('intermediate stops', () => {
  it('adds and replaces stops, never more than two', () => {
    expect(MAX_STOPS).toBe(2);
    const one = withStop([], 0, point('Dorixona'));
    const two = withStop(one, 1, point('Maktab'));
    expect(two.map((p) => p.address)).toEqual(['Dorixona', 'Maktab']);
    expect(withStop(two, 0, point('Bozor')).map((p) => p.address)).toEqual(['Bozor', 'Maktab']);
    expect(withStop(two, 2, point('Uchinchi'))).toHaveLength(2);
    expect(withStop([], 1, point('Bo‘shliq'))).toEqual([]);
  });

  it('shows the stops’ fees as their own line of the price', () => {
    const fare = {
      kind: 'city',
      rideClass: 'economy',
      distanceM: 5200,
      insideM: 5200,
      outsideM: 0,
      base: 10_000,
      outside: 0,
      night: 0,
      options: {},
      stops: { count: 2, fee: 2000 },
      total: 12_000,
      seat: null,
    } as Fare;
    const lines = fareLines(fare, 1500);
    expect(lines.map((l) => [s(l.label), l.amount])).toEqual([
      ['Shahar ichida, 5,2 km', 10_000],
      ['Oraliq manzillar × 2', 2000],
      ['Pullik kutish', 1500],
    ]);
  });

  it('explains the stop rules and each stop’s state', () => {
    expect(
      s(stopRulesText({ max: 2, perStop: 1000, freeMinutes: 3, waitingPerMinute: 500 })!),
    ).toBe(
      'Har bir oraliq manzil 1 000 so‘m. U yerda 3 daqiqa kutish bepul, keyin har daqiqa 500 so‘m. Naqd safarda manzillarni keyin ham o‘zgartirish mumkin — narx qayta hisoblanadi.',
    );
    expect(stopRulesText(undefined)).toBeNull();
    expect(stopStateText({ arrivedAt: null, leftAt: null, waitingFee: 0 })).toBe('Oldinda');
    expect(stopStateText({ arrivedAt: 'x', leftAt: null, waitingFee: 0 })).toBe(
      'Mashina shu yerda kutmoqda',
    );
    expect(s(stopStateText({ arrivedAt: 'x', leftAt: 'y', waitingFee: 1500 }))).toBe(
      'O‘tildi · kutish 1 500 so‘m',
    );
  });
});

describe('in Russian', () => {
  afterEach(() => setLanguage('uz'));

  it('explains the stop rules and states', () => {
    setLanguage('ru');
    expect(
      s(stopRulesText({ max: 2, perStop: 1000, freeMinutes: 3, waitingPerMinute: 500 })!),
    ).toBe(
      'Каждая остановка — 1 000 сум. Ожидание там 3 мин бесплатно, затем 500 сум за минуту. В поездке за наличные остановки можно изменить и позже — цена пересчитается.',
    );
    expect(stopStateText({ arrivedAt: 'x', leftAt: null, waitingFee: 0 })).toBe(
      'Машина ждёт здесь',
    );
    expect(s(stopStateText({ arrivedAt: 'x', leftAt: 'y', waitingFee: 1500 }))).toBe(
      'Пройдена · ожидание 1 500 сум',
    );
  });
});
