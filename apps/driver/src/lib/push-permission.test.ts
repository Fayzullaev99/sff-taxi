import { describe, expect, it } from 'vitest';
import { pushPermissionState } from './push-permission';

describe('pushPermissionState', () => {
  it('treats Android 13+ "denied" for a never-asked permission as askable', () => {
    expect(
      pushPermissionState({ granted: false, status: 'denied', canAskAgain: true }, false),
    ).toBe('undetermined');
  });

  it('is denied after the intro was shown and the driver refused', () => {
    expect(pushPermissionState({ granted: false, status: 'denied', canAskAgain: true }, true)).toBe(
      'denied',
    );
  });

  it('is blocked once the system will not ask again', () => {
    expect(
      pushPermissionState({ granted: false, status: 'denied', canAskAgain: false }, true),
    ).toBe('blocked');
    expect(
      pushPermissionState({ granted: false, status: 'denied', canAskAgain: false }, false),
    ).toBe('blocked');
  });

  it('keeps granted and a real undetermined', () => {
    expect(
      pushPermissionState({ granted: true, status: 'granted', canAskAgain: true }, false),
    ).toBe('granted');
    expect(
      pushPermissionState({ granted: false, status: 'undetermined', canAskAgain: true }, true),
    ).toBe('undetermined');
  });
});
