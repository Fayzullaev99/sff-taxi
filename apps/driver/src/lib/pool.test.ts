import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import {
  alongLine,
  alongStopLines,
  destinationChip,
  extraPassengersStep,
  isPin,
  isPinError,
  offerBadges,
  parseRecent,
  pushRecent,
  pinInput,
  poolRideIds,
  poolSettings,
  preferencesError,
  ridePool,
  seatLayout,
  seatsText,
  stopAction,
} from './pool';

describe('seating rule', () => {
  it('one in front, never more than two in the back', () => {
    expect(seatLayout(0)).toEqual({ occupied: 0, capacity: 3, front: 0, rear: 0, free: 3 });
    expect(seatLayout(1)).toMatchObject({ front: 1, rear: 0, free: 2 });
    expect(seatLayout(3)).toMatchObject({ front: 1, rear: 2, free: 0 });
    // a 7-seat car still takes 3; asking for more is capped
    expect(seatLayout(5, 7)).toMatchObject({ occupied: 3, capacity: 3, rear: 2 });
    expect(seatLayout(2, 2)).toMatchObject({ capacity: 2, front: 1, rear: 1, free: 0 });
  });

  it('describes the seats', () => {
    expect(seatsText(seatLayout(2))).toBe('Oldinda 1/1 · orqada 1/2 · 1 ta bo‘sh');
    expect(seatsText(seatLayout(3))).toBe('Oldinda 1/1 · orqada 2/2 · bo‘sh joy yo‘q');
  });
});

describe('poolSettings', () => {
  it('reads driver/me pool, tolerating an older API', () => {
    expect(poolSettings({})).toBeNull();
    expect(poolSettings({ pool: null })).toBeNull();
    const s = poolSettings({
      pool: {
        enabled: true,
        extraPassengers: 1,
        destination: { lat: 40.3, lng: 68.8, address: 'Yangiyer, Sirdaryo' },
        seats: { occupied: 1, capacity: 3, front: 1, rear: 0, free: 2 },
      },
    });
    expect(s).toMatchObject({ enabled: true, extraPassengers: 1, seats: { free: 2 } });
    expect(s?.destination?.address).toBe('Yangiyer, Sirdaryo');
    // seats missing: computed the same way as the API
    expect(poolSettings({ pool: { enabled: false, extraPassengers: 2 } })?.seats).toMatchObject({
      front: 1,
      rear: 1,
    });
  });
});

describe('extraPassengersStep', () => {
  it('stays within 0–3 and asks for a destination before people ride along', () => {
    expect(extraPassengersStep(0, 1, false)).toEqual({ value: 1, needsDestination: true });
    expect(extraPassengersStep(0, 1, true)).toEqual({ value: 1, needsDestination: false });
    expect(extraPassengersStep(3, 1, true).value).toBe(3);
    expect(extraPassengersStep(0, -1, false)).toEqual({ value: 0, needsDestination: false });
    expect(extraPassengersStep(1, 5, true, 2).value).toBe(2);
  });
});

describe('texts', () => {
  it('destination chip', () => {
    expect(destinationChip({ lat: 1, lng: 2, address: 'Yangiyer, Sirdaryo viloyati' })).toBe(
      'Faqat yo‘lingizdagi buyurtmalar: → Yangiyer',
    );
    expect(destinationChip(null)).toBeNull();
  });

  it('offer badges', () => {
    expect(offerBadges({})).toEqual([]);
    expect(
      offerBadges({ passengers: 2, shareable: true, womenOnly: true }).map((b) => b.label),
    ).toEqual(['2 kishi', 'Hamroh', 'Ayol haydovchi so‘ralgan']);
    expect(offerBadges({ passengers: 2, fareMode: 'seat' })[0]!.label).toBe('O‘rindiq, 2 kishi');
  });

  it('along the way', () => {
    expect(alongLine(230)).toBe('Yo‘lingizda: +4 daq aylanish');
    expect(alongLine(0)).toBe('Yo‘lingizda: aylanishsiz');
    expect(alongLine(null)).toBe('Yo‘lingizda: aylanishsiz');
    const lines = alongStopLines(
      [
        { rideId: 'A', type: 'pickup' },
        { rideId: 'N', type: 'pickup' },
        { rideId: 'A', type: 'dropoff' },
        { rideId: 'N', type: 'dropoff' },
        { rideId: null, type: 'destination' },
      ],
      'n',
      new Map([['A', 'Dilnoza']]),
    );
    expect(lines.map((l) => l.text)).toEqual([
      'Dilnoza — olish',
      'Yangi yo‘lovchi — olish',
      'Dilnoza — tushirish',
      'Yangi yo‘lovchi — tushirish',
      'Sizning manzilingiz',
    ]);
    expect(lines.filter((l) => l.isNew)).toHaveLength(2);
  });
});

describe('several riders', () => {
  const pool = {
    riders: 2,
    stops: [
      { rideId: 'R2', type: 'pickup' as const, lat: 1, lng: 1, status: 'driver_assigned' },
      { rideId: 'R1', type: 'dropoff' as const, lat: 2, lng: 2, status: 'in_progress' },
      { rideId: 'R2', type: 'dropoff' as const, lat: 3, lng: 3, status: 'driver_assigned' },
    ],
  };

  it('finds the pool only on a current ride view', () => {
    expect(ridePool({ pool: null })).toBeNull();
    expect(ridePool({ pool: { id: 'p', sharedM: 100 } })).toBeNull();
    expect(ridePool({ pool })?.stops).toHaveLength(3);
    expect(poolRideIds(ridePool({ pool }), 'R2')).toEqual(['r2', 'r1']);
  });

  it('the button follows the stop', () => {
    expect(stopAction('pickup', 'driver_assigned')).toBe('arrive');
    expect(stopAction('pickup', 'driver_arrived')).toBe('start');
    expect(stopAction('dropoff', 'in_progress')).toBe('complete');
    expect(stopAction('dropoff', 'driver_assigned')).toBeNull();
  });
});

describe('start code', () => {
  it('takes 4 digits', () => {
    expect(pinInput('12a3 45')).toBe('1234');
    expect(isPin('1234')).toBe(true);
    expect(isPin('123')).toBe(false);
  });

  it('recognises a refused code', () => {
    expect(
      isPinError(new ApiError(400, 'Kod noto‘g‘ri: yo‘lovchidan 4 xonali kodni so‘rang')),
    ).toBe(true);
    expect(isPinError(new ApiError(409, 'Kod'))).toBe(false);
  });
});

describe('preferencesError', () => {
  it('shows the API reason for refusals', () => {
    expect(preferencesError(new ApiError(409, 'Mashinada 3 tadan ortiq yo‘lovchi bo‘lmaydi'))).toBe(
      'Mashinada 3 tadan ortiq yo‘lovchi bo‘lmaydi',
    );
    expect(preferencesError(new ApiError(0, 'x'))).toMatch(/Internet/);
    expect(preferencesError(new ApiError(500, 'x'))).toMatch(/saqlanmadi/);
  });
});

describe('recent destinations', () => {
  it('keeps the newest first without near-duplicates', () => {
    const a = { lat: 40.3, lng: 68.8, address: 'Yangiyer' };
    const b = { lat: 40.49, lng: 68.78, address: 'Guliston' };
    const list = pushRecent(pushRecent([], a), b);
    expect(list.map((d) => d.address)).toEqual(['Guliston', 'Yangiyer']);
    expect(pushRecent(list, { ...a, lat: 40.3001 }).map((d) => d.address)).toEqual([
      'Yangiyer',
      'Guliston',
    ]);
    expect(parseRecent([a, null, { lat: 'x' }, b])).toHaveLength(2);
    expect(parseRecent('junk')).toEqual([]);
  });
});
