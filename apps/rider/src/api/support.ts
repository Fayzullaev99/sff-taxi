import Constants from 'expo-constants';
import { supportPhone, telegramHandle, telegramLink, updateRequired } from '../lib/app-config';
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

/** True when the API asks riders on this version to update first. */
export function useUpdateRequired(): { required: boolean; minimum: string | null } {
  const config = useAppConfig().data;
  const minimum = config?.minAppVersion.rider ?? null;
  return { required: updateRequired(APP_VERSION, minimum), minimum };
}

/** Whether a feature is switched on; true until the config has answered (the API decides). */
export function useFeature(name: 'cardPayments' | 'intercity' | 'scheduledRides'): boolean {
  const config = useAppConfig().data;
  return config ? config.features[name] !== false : true;
}
