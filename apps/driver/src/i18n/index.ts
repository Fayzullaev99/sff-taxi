/**
 * The language in the running app: read once at start-up (the saved choice, else the
 * phone's language), switched from the profile and applied at once, without a restart.
 * Screens take `t` from `useT()` so they re-render when it changes; the root layout
 * listens with `onLanguageChange` to tell the API and refetch what it worded.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { NativeModules, Platform } from 'react-native';
import {
  getLanguage,
  type Language,
  languageFromTag,
  LANGUAGE_NAMES,
  LANGUAGES,
  isLanguage,
  setLanguage,
  subscribeLanguage,
} from './core';
import { liveTable, t, type TKey } from './dictionary';

export { t, liveTable, LANGUAGE_NAMES, LANGUAGES, getLanguage };
export type { Language, TKey };

const STORAGE_KEY = 'sff.taxi.driver.language';

/** The phone's language tag ("ru-RU", "uz-Latn-UZ"), from Intl or the native settings. */
export function deviceLanguageTag(): string | null {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    if (tag && tag !== 'und') return tag;
  } catch {
    // no Intl on this runtime: the native settings below
  }
  try {
    if (Platform.OS === 'android') {
      const id = (NativeModules.I18nManager as { localeIdentifier?: string } | undefined)
        ?.localeIdentifier;
      return id ?? null;
    }
    const settings = (
      NativeModules.SettingsManager as
        { settings?: { AppleLocale?: string; AppleLanguages?: string[] } } | undefined
    )?.settings;
    return settings?.AppleLocale ?? settings?.AppleLanguages?.[0] ?? null;
  } catch {
    return null;
  }
}

let initialized: Promise<void> | null = null;

/** Applies the saved language, else the phone's (ru → Russian, anything else → Uzbek). */
export function initLanguage(): Promise<void> {
  initialized ??= (async () => {
    const saved = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
    setLanguage(isLanguage(saved) ? saved : languageFromTag(deviceLanguageTag()));
  })();
  return initialized;
}

const changeListeners = new Set<(lang: Language) => void>();

/** The driver chose a language: applied at once, kept for the next start, listeners told. */
export async function changeLanguage(lang: Language): Promise<void> {
  if (lang === getLanguage()) return;
  setLanguage(lang);
  await AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => undefined);
  for (const l of changeListeners) l(lang);
}

/** Called after a chosen switch (not the start-up read): the API and caches follow. */
export function onLanguageChange(listener: (lang: Language) => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** The current language, re-rendering on a switch. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

/** `t` for components: the screen re-renders in the new language when it is switched. */
export function useT(): { t: typeof t; lang: Language } {
  const lang = useLanguage();
  return { t, lang };
}
