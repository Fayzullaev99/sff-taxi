import { describe, expect, it } from 'vitest';
import {
  cargoLines,
  depositLine,
  parcelLines,
  serviceOf,
  serviceStep,
  showRecipient,
} from './service';

describe('serviceOf', () => {
  it('defaults to taxi (older API)', () => {
    expect(serviceOf({})).toBe('taxi');
    expect(serviceOf({ service: 'cargo' })).toBe('cargo');
    expect(serviceOf({ service: 'delivery' })).toBe('delivery');
    expect(serviceOf({ service: 'boat' })).toBe('taxi');
    expect(serviceOf(null)).toBe('taxi');
  });
});

describe('cargo and parcel lines', () => {
  it('lists class, loaders, weight, the customer riding along and the load', () => {
    expect(
      cargoLines(
        { loaders: 2, riderRides: true, weightKg: 300, description: ' Muzlatkich ' },
        'cargo_s',
      ),
    ).toEqual([
      'Kichik yuk (Damas, Labo)',
      'Yukchi: 2 kishi',
      'Taxminan 300 kg',
      'Mijoz ham boradi (kabinada 1 kishi)',
      'Yuk: Muzlatkich',
    ]);
    expect(cargoLines({ loaders: 0 }, 'economy')).toEqual(['Yukchisiz']);
    expect(cargoLines(null, 'cargo_m')).toEqual(['O‘rta yuk (Gazel, Porter)']);
  });

  it('describes a parcel', () => {
    expect(parcelLines({ description: 'Hujjatlar', weightKg: 1 })).toEqual([
      'Posilka: jo‘natuvchi mashinada bo‘lmaydi',
      'Nima: Hujjatlar',
      'Og‘irligi: ~1 kg',
    ]);
    expect(parcelLines(null)).toHaveLength(1);
  });
});

describe('serviceStep', () => {
  it('keeps the actions, changes the words', () => {
    expect(serviceStep('in_progress', 'taxi')?.button).toBe('Yakunlash');
    expect(serviceStep('in_progress', 'delivery')).toMatchObject({
      action: 'complete',
      button: 'Posilkani topshirdim',
      navigateTo: 'dropoff',
    });
    expect(serviceStep('driver_arrived', 'cargo')).toMatchObject({
      action: 'start',
      button: 'Yuklandi — Boshlash',
    });
    expect(serviceStep('completed', 'cargo')).toBeNull();
  });
});

describe('showRecipient', () => {
  const delivery = { recipientName: 'Anvar', recipientPhone: '+998901234567' };
  it('shows the recipient once the parcel is on its way', () => {
    expect(showRecipient({ service: 'delivery', status: 'driver_arrived', delivery })).toBe(false);
    expect(showRecipient({ service: 'delivery', status: 'in_progress', delivery })).toBe(true);
    expect(showRecipient({ service: 'taxi', status: 'in_progress', delivery })).toBe(false);
    expect(showRecipient({ service: 'delivery', status: 'in_progress', delivery: null })).toBe(
      false,
    );
  });
});

describe('depositLine', () => {
  it('says what was paid in advance and what to take', () => {
    expect(depositLine(10_000, 40_000)).toBe(
      'Oldindan to‘langan 10 000 so‘m, naqd oling 40 000 so‘m',
    );
    expect(depositLine(0, 40_000)).toBeNull();
    expect(depositLine(undefined, 40_000)).toBeNull();
  });
});
