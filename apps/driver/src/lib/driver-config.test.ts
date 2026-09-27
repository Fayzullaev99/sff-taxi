import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BILLING,
  DEFAULT_DECLINE_REASONS,
  DEFAULT_DRIVER_CONFIG,
  mapDriverConfig,
  mapPublicConfig,
  mapReasons,
  passesOnSale,
} from './driver-config';
import { compareVersions, mustUpdate, versionParts } from './version';
import { rulesFromConfig } from './waiting';

/** What the API's AppConfigService.driver() answers. */
const API_DRIVER_CONFIG = {
  billing: {
    promoUntil: '2027-01-31',
    commissionPercent: 4,
    dailyCap: 12_000,
    weeklyCap: 60_000,
    intercityCommissionPercent: 3,
    intercityTripCap: 8_000,
    taxPercent: 1,
    passes: { day: 8_000, week: 45_000 },
    minBalance: -20_000,
  },
  rides: {
    offerTimeoutSeconds: 20,
    broadcastTimeoutSeconds: 40,
    noShowAfterMinutes: 7,
    freeWaitingMinutes: 3,
    waitingPerMinute: 600,
    cancellationFee: 4_000,
  },
  declineReasons: { too_far: 'Juda uzoq', other: 'Boshqa sabab' },
  cancelReasons: { rider_no_show: 'Yo‘lovchi chiqmadi' },
  topups: { min: 5_000, max: 5_000_000, providers: ['payme', 'click', 'paypal'] },
  support: { phone: '+998901112233', telegram: null, officeAddress: 'Guliston, Mustaqillik 1' },
};

describe('mapDriverConfig', () => {
  it('takes every published rule', () => {
    const c = mapDriverConfig(API_DRIVER_CONFIG);
    expect(c.billing).toEqual({
      promoUntil: '2027-01-31',
      commissionPercent: 4,
      dailyCap: 12_000,
      weeklyCap: 60_000,
      intercityPercent: 3,
      intercityTripCap: 8_000,
      taxPercent: 1,
      passDay: 8_000,
      passWeek: 45_000,
      minBalance: -20_000,
    });
    expect(c.rides.noShowAfterMinutes).toBe(7);
    expect(c.declineReasons).toEqual([
      { code: 'too_far', label: 'Juda uzoq' },
      { code: 'other', label: 'Boshqa sabab' },
    ]);
    expect(c.cancelReasons).toHaveLength(1);
    expect(c.topups.providers).toEqual(['payme', 'click']);
    expect(c.support).toEqual({
      phone: '+998901112233',
      telegram: null,
      officeAddress: 'Guliston, Mustaqillik 1',
    });
    expect(rulesFromConfig(c.rides)).toEqual({
      freeMinutes: 3,
      perMinute: 600,
      noShowAfterMinutes: 7,
    });
  });

  it('keeps the defaults for anything missing or malformed', () => {
    expect(mapDriverConfig(undefined)).toEqual(DEFAULT_DRIVER_CONFIG);
    const c = mapDriverConfig({
      billing: { commissionPercent: '5', dailyCap: null },
      declineReasons: {},
      topups: { providers: 'payme' },
    });
    expect(c.billing).toEqual(DEFAULT_BILLING);
    expect(c.declineReasons).toEqual(DEFAULT_DECLINE_REASONS);
    expect(c.topups.providers).toEqual([]);
  });

  it('reads an ended or removed promo as none', () => {
    expect(mapDriverConfig({ billing: { promoUntil: null } }).billing.promoUntil).toBeNull();
    expect(mapDriverConfig({ billing: { promoUntil: 'soon' } }).billing.promoUntil).toBeNull();
  });

  it('fills the support contacts the API leaves empty from the build', () => {
    const fallback = { phone: '+998900000000', telegram: '@sff', officeAddress: 'Ofis' };
    expect(mapDriverConfig({ support: { phone: '+998901112233' } }, fallback).support).toEqual({
      phone: '+998901112233',
      telegram: '@sff',
      officeAddress: 'Ofis',
    });
  });

  it('accepts reasons as a list too', () => {
    expect(mapReasons([{ code: 'a', label: 'A' }, { code: 'b' }], [])).toEqual([
      { code: 'a', label: 'A' },
    ]);
  });

  it('sells passes only when they have prices and there is a commission', () => {
    expect(passesOnSale(DEFAULT_BILLING)).toBe(true);
    expect(passesOnSale({ ...DEFAULT_BILLING, passDay: 0 })).toBe(false);
    expect(passesOnSale({ ...DEFAULT_BILLING, commissionPercent: 0 })).toBe(false);
  });
});

describe('mapPublicConfig', () => {
  it('reads the minimum driver version, features and providers', () => {
    const c = mapPublicConfig({
      support: { phone: null, telegram: '@sfftaxi', officeAddress: null },
      minAppVersion: { rider: '1.0.0', driver: '1.2.0' },
      features: {
        cardPayments: true,
        uploads: false,
        intercity: true,
        maskedCalls: false,
        scheduledRides: true,
      },
      cardProviders: ['click'],
      shareBaseUrl: 'https://taxi.sff.uz',
    });
    expect(c).toEqual({
      support: { phone: null, telegram: '@sfftaxi', officeAddress: null },
      minDriverVersion: '1.2.0',
      features: { cardPayments: true, uploads: false, intercity: true, scheduledRides: true },
      cardProviders: ['click'],
    });
    expect(mapPublicConfig(null).minDriverVersion).toBeNull();
  });
});

describe('versions', () => {
  it('compares numerically, part by part', () => {
    expect(versionParts('1.10.2')).toEqual([1, 10, 2]);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('v2.0.0-beta.1', '2.0.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
  });

  it('asks for an update only below a known minimum', () => {
    expect(mustUpdate('1.0.0', '1.0.1')).toBe(true);
    expect(mustUpdate('1.0.1', '1.0.1')).toBe(false);
    expect(mustUpdate('1.4.0', '1.0.0')).toBe(false);
    expect(mustUpdate(null, '2.0.0')).toBe(false);
    expect(mustUpdate('1.0.0', null)).toBe(false);
    expect(mustUpdate('dev', '2.0.0')).toBe(false);
  });
});
