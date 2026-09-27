import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Height of the Android on-screen keyboard (0 when hidden, and always 0 on iOS).
 *
 * Android 15+ draws apps edge to edge, and the window is no longer resized for the
 * keyboard (`adjustResize` has no effect): without this padding the keyboard covers the
 * inputs and buttons at the bottom of a screen (seen on the emulator: the sign-in
 * button hidden under the keypad on a tablet).
 */
export function useAndroidKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setHeight(Math.max(0, e.endCoordinates.height)),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
