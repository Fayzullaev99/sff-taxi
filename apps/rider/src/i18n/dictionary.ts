/**
 * The app's translator: `t('order.title')`, `t('ride.eta', { minutes: 5 })`. Pure (no
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

export { getLanguage, setLanguage, subscribeLanguage } from './core';
export type { Language } from './core';
