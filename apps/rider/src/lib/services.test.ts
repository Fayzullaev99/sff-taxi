import { describe, expect, it } from 'vitest';
import type { CargoClassRules } from '../api/types';
import {
  cargoClassFor,
  cargoFits,
  cargoLimitsText,
  checkRecipient,
  classLabel,
  loadersText,
  loadLine,
  parseWeight,
  serviceOn,
  serviceTitle,
} from './services';

const N = ' ';
const rules = (maxPayloadKg: number): CargoClassRules => ({
  maxPayloadKg,
  includedKm: 10,
  includedMinutes: 20,
  perKm: 1_500,
  intercityPerKm: 1_500,
  perMinute: 300,
  fits: true,
});
const classes = { cargo_s: rules(700), cargo_m: rules(1_500) };

describe('services and classes', () => {
  it('names any class', () => {
    expect(classLabel('economy')).toBe('Ekonom');
    expect(classLabel('cargo_s')).toBe('Kichik yuk mashinasi');
    expect(classLabel('cargo_m')).toBe('O‘rta yuk mashinasi');
  });

  it('offers cargo and delivery unless /config switches them off', () => {
    expect(serviceOn('taxi', { taxi: false })).toBe(true);
    expect(serviceOn('cargo', undefined)).toBe(true);
    expect(serviceOn('cargo', { cargo: false })).toBe(false);
    expect(serviceOn('delivery', { cargo: false })).toBe(true);
  });
});

describe('weights', () => {
  it('reads whole kilograms within the limit; empty is allowed', () => {
    expect(parseWeight('', 10)).toEqual({ kg: null, error: null });
    expect(parseWeight(' 7 ', 10)).toEqual({ kg: 7, error: null });
    expect(parseWeight('2,5', 10)).toEqual({ kg: 3, error: null });
    expect(parseWeight('12', 10)).toEqual({ kg: 12, error: 'Ko‘pi bilan 10 kg' });
    expect(parseWeight('0', 10).error).toBe('Kamida 1 kg');
    expect(parseWeight('besh', 10).error).toBe('Og‘irlikni kilogrammda yozing');
  });

  it('knows which cargo class takes the load', () => {
    expect(cargoFits(rules(700), 650)).toBe(true);
    expect(cargoFits(rules(700), 800)).toBe(false);
    expect(cargoFits(rules(700), null)).toBe(true);
    expect(cargoFits(undefined, 5_000)).toBe(true);
    expect(cargoClassFor(classes, 500, 'cargo_s')).toBe('cargo_s');
    expect(cargoClassFor(classes, 900, 'cargo_s')).toBe('cargo_m');
    expect(cargoClassFor(classes, 900, 'cargo_m')).toBe('cargo_m');
    // too heavy for both: the choice stays (the card says it does not fit)
    expect(cargoClassFor(classes, 3_000, 'cargo_s')).toBe('cargo_s');
  });

  it('describes a class’s limits and the loaders', () => {
    expect(cargoLimitsText(rules(700))).toBe(
      `700 kg gacha · 10 km va 20 daq narxga kiradi, keyin 1${N}500${N}so‘m/km`,
    );
    expect(loadersText(0, 30_000)).toContain('Yukchisiz');
    expect(loadersText(2, 30_000)).toBe(`2 ta yukchi · har biri 30${N}000${N}so‘m`);
  });
});

describe('the recipient of a parcel', () => {
  it('needs a name and a valid Uzbek phone', () => {
    expect(checkRecipient(' Dilnoza ', '90 123 45 67')).toEqual({
      ok: true,
      name: 'Dilnoza',
      phone: '+998901234567',
      nameError: null,
      phoneError: null,
    });
    const bad = checkRecipient('', '123');
    expect(bad.ok).toBe(false);
    expect(bad.nameError).toBeTruthy();
    expect(bad.phoneError).toContain('noto‘g‘ri');
    expect(checkRecipient('Ali', '').phoneError).toContain('telefonini');
  });
});

describe('the ride screen for cargo and parcels', () => {
  it('speaks of a cargo car or a parcel, taxi stays as it is', () => {
    expect(serviceTitle('cargo', 'assigned', 'Haydovchi yo‘lda')).toBe('Yuk mashinasi yo‘lda');
    expect(serviceTitle('delivery', 'on_trip', 'Safardasiz')).toBe('Posilka yo‘lda');
    expect(serviceTitle('cargo', 'cancelled', 'Buyurtma bekor qilindi')).toBe(
      'Buyurtma bekor qilindi',
    );
    expect(serviceTitle(undefined, 'assigned', 'Haydovchi yo‘lda')).toBe('Haydovchi yo‘lda');
  });

  it('sums up the load or the parcel', () => {
    expect(
      loadLine({
        service: 'cargo',
        cargo: { loaders: 2, riderRides: true, description: 'Divan', weightKg: 80 },
      }),
    ).toBe('Divan · 80 kg · 2 ta yukchi · o‘zingiz kabinada');
    expect(
      loadLine({
        service: 'cargo',
        cargo: { loaders: 0, riderRides: false, description: null, weightKg: null },
      }),
    ).toBe('Yuk');
    expect(
      loadLine({
        service: 'delivery',
        delivery: { parcel: { description: 'Hujjatlar', weightKg: 1 }, recipientName: 'Aziz' },
      }),
    ).toBe('Hujjatlar, 1 kg → Aziz');
    expect(loadLine({ service: 'taxi' })).toBeNull();
  });
});
