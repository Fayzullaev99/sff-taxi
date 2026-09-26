import { Linking, Share } from 'react-native';
import { notify } from './dialogs';

/**
 * The dispatch office's number (EXPO_PUBLIC_OPERATOR_PHONE). The API does not publish
 * one yet; without it the "call the operator" buttons are hidden.
 */
export const OPERATOR_PHONE = (process.env.EXPO_PUBLIC_OPERATOR_PHONE ?? '').trim() || null;

/** Opens the phone's dialer with the number filled in (no CALL_PHONE permission needed). */
export async function callPhone(phone: string): Promise<void> {
  const number = phone.replace(/[^\d+]/g, '');
  try {
    await Linking.openURL(`tel:${number}`);
  } catch {
    notify('Qo‘ng‘iroq qilib bo‘lmadi', `Raqamni qo‘lda tering: ${phone}`);
  }
}

/** The system share sheet (Telegram, SMS, ...), for the share-trip link. */
export async function shareText(message: string, url: string): Promise<void> {
  try {
    await Share.share({ message: `${message}\n${url}`, url });
  } catch {
    // dismissed or unavailable: nothing to do
  }
}
