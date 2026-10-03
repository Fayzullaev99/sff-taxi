import Ionicons from '@expo/vector-icons/Ionicons';
import { useNetInfo } from '@react-native-community/netinfo';
import { type ReactNode, useEffect, useRef } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAndroidKeyboardHeight } from './keyboard';
import { colors, space, TOUCH } from './theme';

/** A strip pinned above the page while the phone has no connection. */
export function OfflineBanner() {
  const net = useNetInfo();
  if (net.isConnected !== false) return null;
  return (
    <View style={styles.offline} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline" size={22} color={colors.onDanger} />
      <Text style={styles.offlineText}>
        Internet yo‘q. Buyurtmalar kelmaydi — aloqa tiklanishi bilan hammasi yangilanadi.
      </Text>
    </View>
  );
}

/** A scrolling page with the offline strip, optional back button and pull-to-refresh. */
export function Screen(props: {
  title?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  keyboard?: boolean;
  /**
   * A short form whose button is last (sign-in): scroll it into view when the keyboard opens
   * (a landscape tablet has room for little else above the keypad).
   */
  scrollToEndOnKeyboard?: boolean;
  onBack?: () => void;
}) {
  // Android: the window is not resized for the keyboard (edge to edge), so make room here
  const keyboardHeight = useAndroidKeyboardHeight();
  const scroll = useRef<ScrollView>(null);
  const toEnd = props.scrollToEndOnKeyboard;
  useEffect(() => {
    if (!toEnd) return;
    // after the padding for the keyboard has been laid out
    const sub = Keyboard.addListener('keyboardDidShow', () =>
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50),
    );
    return () => sub.remove();
  }, [toEnd]);
  const body = (
    <ScrollView
      ref={scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        props.onRefresh ? (
          <RefreshControl
            refreshing={!!props.refreshing}
            onRefresh={props.onRefresh}
            colors={[colors.onBrand]}
            progressBackgroundColor={colors.brand}
            tintColor={colors.brand}
          />
        ) : undefined
      }
    >
      {props.onBack || props.title ? (
        <View style={styles.header}>
          {props.onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Orqaga"
              onPress={props.onBack}
              hitSlop={8}
              style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="arrow-back" size={28} color={colors.text} />
            </Pressable>
          ) : null}
          {props.title ? <Text style={styles.title}>{props.title}</Text> : null}
        </View>
      ) : null}
      {props.children}
    </ScrollView>
  );
  return (
    <SafeAreaView
      style={[styles.safe, keyboardHeight ? { paddingBottom: keyboardHeight } : null]}
      // a pinned footer clears the navigation bar / home indicator (tab screens have no footer,
      // and the keyboard padding replaces the inset while it is open)
      edges={
        props.footer && !keyboardHeight
          ? ['top', 'left', 'right', 'bottom']
          : ['top', 'left', 'right']
      }
    >
      <OfflineBanner />
      {props.keyboard ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
      {props.footer ? <View style={styles.footer}>{props.footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  back: {
    width: TOUCH,
    height: TOUCH,
    marginLeft: -space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 28, fontWeight: '800', color: colors.text },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.danger,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  offlineText: { flex: 1, color: colors.onDanger, fontSize: 15, fontWeight: '800' },
  footer: {
    padding: space.lg,
    gap: space.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
