/**
 * The app's translator: `t('ride.arrived')`, `t('money.balance', { amount })`. Pure (no
 * React Native): screens use `useT()` from src/i18n to re-render on a language switch,
 * plain modules call `t` from here.
 */
import { createTranslator, type KeyOf } from './core';
import { ru } from './ru';
import { uz } from './uz';

export type Dictionary = typeof uz;
/** Every text key: a wrong or missing one fails the typecheck. */
export type TKey = KeyOf<Dictionary>;

export const dictionaries = { uz, ru } as const;

export const t = createTranslator<Dictionary>({ uz, ru });

/**
 * A label table (`RIDE_CLASSES[c]`, `Object.entries(LEDGER_KINDS)`) that reads each label
 * in the current language on every access, so existing call sites stay as they are.
 */
export function liveTable<K extends string>(keys: Record<K, TKey>): Record<K, string> {
  const names = Object.keys(keys) as K[];
  const value = (k: K) => t(keys[k]);
  return new Proxy({} as Record<K, string>, {
    get: (_, prop) => (typeof prop === 'string' && prop in keys ? value(prop as K) : undefined),
    has: (_, prop) => typeof prop === 'string' && prop in keys,
    ownKeys: () => names,
    getOwnPropertyDescriptor: (_, prop) =>
      typeof prop === 'string' && prop in keys
        ? { value: value(prop as K), enumerable: true, configurable: true, writable: false }
        : undefined,
  });
}

export { getLanguage, setLanguage, subscribeLanguage } from './core';
export type { Language } from './core';
