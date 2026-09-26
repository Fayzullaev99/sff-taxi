import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from './theme';

/** A bottom sheet on a dimmed backdrop; tapping outside or back closes it. */
export function Sheet({
  visible,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling content, above the home indicator. */
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Yopish" />
        <View style={[styles.sheet, { paddingBottom: footer ? 0 : insets.bottom }]}>
          <View style={styles.handle} />
          {children}
          {footer ? (
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space(4)) }]}>
              {footer}
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: space(2),
    marginBottom: space(1),
    position: 'absolute',
    top: 0,
    zIndex: 2,
  },
  footer: {
    paddingHorizontal: space(4),
    paddingTop: space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
