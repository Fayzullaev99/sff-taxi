import { Alert } from 'react-native';
import { t } from '../i18n/dictionary';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText: string;
  cancelText?: string;
  destructive?: boolean;
}

/** A native two-button dialog as a promise: true when the rider confirmed. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      options.title,
      options.message,
      [
        {
          text: options.cancelText ?? t('common.actions.cancel'),
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: options.confirmText,
          style: options.destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function notify(title: string, message?: string): void {
  Alert.alert(title, message);
}
