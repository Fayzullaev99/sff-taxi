import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  riderStoreLink,
  type StoreLink,
  supportPhone,
  telegramHandle,
  telegramLink,
  updateRequired,
} from '../lib/app-config';
import { OPERATOR_PHONE } from '../lib/links';
import { useAppConfig } from './queries';

/** This build's version (app.config.ts `version`), compared with the API's minimum. */
export const APP_VERSION = Constants.expoConfig?.version ?? null;

/** The dispatch office and support chat, from GET /config (the build's number as fallback). */
export function useSupport() {
  const config = useAppConfig().data;
  const telegram = config?.support.telegram;
  return {
    phone: supportPhone(config?.support.phone, OPERATOR_PHONE),
    telegramUrl: telegramLink(telegram),
    telegramHandle: telegramHandle(telegram),
    officeAddress: config?.support.officeAddress ?? null,
  };
}

/**
 * True when the API asks riders on this version to update first (a null minimum: never),
 * with where to update from (the API's store page, else the app's own fallback).
 */
export function useUpdateRequired(): {
  required: boolean;
  minimum: string | null;
  store: StoreLink | null;
} {
  const config = useAppConfig().data;
  const minimum = config?.minAppVersion.rider ?? null;
  return {
    required: updateRequired(APP_VERSION, minimum),
    minimum,
    store: riderStoreLink(Platform.OS, config?.storeUrls?.rider),
  };
}

/** Whether a feature is switched on; true until the config has answered (the API decides). */
export function useFeature(name: 'cardPayments' | 'intercity' | 'scheduledRides'): boolean {
  const config = useAppConfig().data;
  return config ? config.features[name] !== false : true;
}

/** The seat board's cancellation rules riders agree to (GET /config), null until it answers. */
export function useIntercityRules(): {
  freeCancelMinutes: number;
  lateCancelFeePercent: number;
} | null {
  return useAppConfig().data?.intercity ?? null;
}
