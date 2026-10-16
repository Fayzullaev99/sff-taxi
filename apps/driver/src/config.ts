import { t } from './i18n/dictionary';

/** Where the API lives. The default reaches the host machine (API on :3200) from the Android emulator. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3200').replace(
  /\/+$/,
  '',
);

/** Driver support / office line shown on the status, top-up and appeal screens; hidden when not set. */
export const SUPPORT_PHONE = process.env.EXPO_PUBLIC_SUPPORT_PHONE?.trim() || null;

/**
 * Where drivers top up in cash and appeal decisions in person: the build's value, else the
 * default in the app's language.
 */
export function officeAddress(): string {
  return process.env.EXPO_PUBLIC_OFFICE_ADDRESS?.trim() || t('common.app.office');
}

/** SFF Taxi brand, shared with the rider app: yellow on near-black. */
export const BRAND = '#FFC400';
export const BRAND_INK = '#111111';
