import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SignInForm } from '../auth/SignInForm';
import { Icon } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';
import { KeyboardAvoider } from '../ui/KeyboardAvoider';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoider style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space(8) }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logo} importantForAccessibility="no-hide-descendants">
          <Icon name="car-sport" size={36} color={colors.ink} />
        </View>
        <SignInForm onDone={() => router.replace('/home')} />
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(5), gap: space(5) },
  logo: {
    width: 68,
    height: 68,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
