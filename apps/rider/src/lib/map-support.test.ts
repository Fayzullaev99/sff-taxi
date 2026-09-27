import { describe, expect, it } from 'vitest';
import { canShowNativeMap, parseCoordinate } from './map-support';

describe('canShowNativeMap', () => {
  it('needs a Google Maps key baked into Android builds', () => {
    expect(canShowNativeMap('android', { androidMapsKey: true })).toBe(true);
    expect(canShowNativeMap('android', { androidMapsKey: false })).toBe(false);
    expect(canShowNativeMap('android', {})).toBe(false);
    expect(canShowNativeMap('android', undefined)).toBe(false);
    expect(canShowNativeMap('android', null)).toBe(false);
  });

  it('always has Apple Maps on iOS, never a native map on the web', () => {
    expect(canShowNativeMap('ios', undefined)).toBe(true);
    expect(canShowNativeMap('web', { androidMapsKey: true })).toBe(false);
  });
});

describe('parseCoordinate', () => {
  it('reads dots and commas', () => {
    expect(parseCoordinate('40.4959', 90)).toBe(40.4959);
    expect(parseCoordinate(' 68,7758 ', 180)).toBe(68.7758);
    expect(parseCoordinate('-12', 90)).toBe(-12);
  });

  it('refuses text, empty input and out-of-range values', () => {
    expect(parseCoordinate('', 90)).toBeNull();
    expect(parseCoordinate('abc', 90)).toBeNull();
    expect(parseCoordinate('40.', 90)).toBeNull();
    expect(parseCoordinate('91', 90)).toBeNull();
    expect(parseCoordinate('181', 180)).toBeNull();
  });
});
