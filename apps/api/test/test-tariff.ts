import { DEFAULT_TARIFF, type Tariff } from '../src/lib/tariff.js';

/**
 * The tariff the suite runs with: the defaults without the night add-on, so fares do not
 * depend on the hour the tests run (23:00-06:00 Tashkent added 20%). global-setup stores it
 * as the "tariff" setting; tests that change the tariff restore it.
 */
export const TEST_TARIFF: Tariff = {
  ...structuredClone(DEFAULT_TARIFF),
  night: { ...DEFAULT_TARIFF.night, percent: 0 },
};
