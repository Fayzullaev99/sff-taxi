import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/dictionary';
import { offlineMessage, SHOW_AFTER_MS } from './offline-message';

afterEach(() => setLanguage('uz'));

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

  it('speaks Russian when the app does', () => {
    setLanguage('ru');
    expect(offlineMessage({ isConnected: false, isInternetReachable: null }).text).toBe(
      'Нет подключения к интернету. Переподключаемся…',
    );
    expect(offlineMessage({ isConnected: true, isInternetReachable: true }).text).toBe(
      'Нет связи с сервером. Переподключаемся…',
    );
  });

  it('waits a few seconds before showing', () => {
    expect(SHOW_AFTER_MS).toBeGreaterThanOrEqual(2000);
  });
});
