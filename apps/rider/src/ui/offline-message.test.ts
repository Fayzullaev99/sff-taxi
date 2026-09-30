import { describe, expect, it } from 'vitest';
import { offlineMessage, SHOW_AFTER_MS } from './offline-message';

describe('offline strip message', () => {
  it('blames the phone only when it surely has no internet', () => {
    expect(offlineMessage({ isConnected: false, isInternetReachable: null }).text).toMatch(
      /^Internet aloqasi yo‘q/,
    );
    expect(offlineMessage({ isConnected: true, isInternetReachable: false }).text).toMatch(
      /^Internet aloqasi yo‘q/,
    );
  });

  it('says the server does not answer when the phone is online (or not known yet)', () => {
    expect(offlineMessage({ isConnected: true, isInternetReachable: true }).text).toMatch(
      /^Server bilan aloqa yo‘q/,
    );
    expect(offlineMessage({ isConnected: null, isInternetReachable: null }).icon).toBe(
      'server-outline',
    );
  });

  it('waits a few seconds before showing', () => {
    expect(SHOW_AFTER_MS).toBeGreaterThanOrEqual(2000);
  });
});
