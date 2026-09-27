import { type ReactNode, useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

/**
 * Height of the Android on-screen keyboard (0 when hidden).
 *
 * Android 15+ draws apps edge to edge and no longer resizes the window for the keyboard
 * (`adjustResize` has no effect), so screens must make room themselves: without it the
 * keyboard covered the order screen's landmark and comment and the support reply box.
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

interface Props {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** iOS: height of what sits above this view (the navigation header). */
  keyboardVerticalOffset?: number;
}

/**
 * Keeps inputs and bottom buttons above the keyboard. The view must reach the bottom of
 * the screen: on Android it is padded by the keyboard's height.
 */
export function KeyboardAvoider(props: Props) {
  return Platform.OS === 'ios' ? <IosAvoider {...props} /> : <AndroidAvoider {...props} />;
}

function IosAvoider({ style, children, keyboardVerticalOffset = 0 }: Props) {
  return (
    <KeyboardAvoidingView
      style={style}
      behavior="padding"
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

function AndroidAvoider({ style, children }: Props) {
  const keyboardHeight = useAndroidKeyboardHeight();
  return (
    <View style={[style, keyboardHeight ? { paddingBottom: keyboardHeight } : null]}>
      {children}
    </View>
  );
}
