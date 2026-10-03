import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isPin, pinInput } from '../lib/pool';
import { Button, Muted } from '../ui/components';
import { haptics } from '../ui/haptics';
import { colors, radius, space } from '../ui/theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

/**
 * The start code: the rider tells the driver 4 digits, the trip starts only with them.
 * A big keypad (the phone sits in a holder), the code is sent as soon as 4 digits are in.
 */
export function PinPad(props: {
  visible: boolean;
  riderName: string | null;
  busy: boolean;
  /** "Kod noto‘g‘ri" and the like; cleared when the driver types again. */
  error: { text: string; n: number } | null;
  onSubmit: (pin: string) => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState('');
  const [shownError, setShownError] = useState<string | null>(null);
  useEffect(() => {
    if (props.visible) setPin('');
  }, [props.visible]);
  useEffect(() => {
    setShownError(props.error?.text ?? null);
    if (props.error) {
      haptics.error();
      setPin('');
    }
  }, [props.error]);

  const press = (k: (typeof KEYS)[number]) => {
    if (props.busy) return;
    haptics.select();
    setShownError(null);
    const next = k === 'clear' ? '' : k === 'back' ? pin.slice(0, -1) : pinInput(pin + k);
    setPin(next);
    if (isPin(next) && next !== pin) props.onSubmit(next);
  };

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={styles.safe}>
        {/* scrolls where the keypad does not fit (landscape, a short phone, a large font) */}
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Boshlash kodi</Text>
          <Muted center>
            {props.riderName ? `${props.riderName}dan` : 'Yo‘lovchidan'} 4 xonali kodni so‘rang: u
            ilovasida ko‘rinadi.
          </Muted>
          <View
            style={styles.dots}
            accessible
            accessibilityLabel={`${pin.length} ta raqam kiritildi`}
          >
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotOn]}>
                <Text style={styles.dotText} maxFontSizeMultiplier={1.2}>
                  {pin[i] ?? ''}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.error} accessibilityLiveRegion="assertive">
            {props.busy ? 'Tekshirilmoqda…' : (shownError ?? ' ')}
          </Text>
          <View style={styles.keys}>
            {KEYS.map((k) => (
              <Pressable
                key={k}
                onPress={() => press(k)}
                disabled={props.busy}
                accessibilityRole="button"
                accessibilityLabel={k === 'back' ? 'O‘chirish' : k === 'clear' ? 'Tozalash' : k}
                style={({ pressed }) => [styles.key, pressed && { backgroundColor: colors.border }]}
              >
                {k === 'back' ? (
                  <Ionicons name="backspace" size={30} color={colors.text} />
                ) : k === 'clear' ? (
                  <Text style={styles.keySmall}>Tozalash</Text>
                ) : (
                  <Text style={styles.keyText} maxFontSizeMultiplier={1.2}>
                    {k}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
          <Button title="Bekor qilish" variant="secondary" onPress={props.onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flexGrow: 1, padding: space.lg, gap: space.md, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '900', color: colors.text, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: space.md, justifyContent: 'center' },
  dot: {
    width: 56,
    height: 68,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: { borderColor: colors.brand },
  dotText: { fontSize: 34, fontWeight: '900', color: colors.brand },
  error: { color: colors.danger, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  keys: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.sm,
    maxWidth: 420,
    alignSelf: 'center',
  },
  key: {
    width: '30%',
    minHeight: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { fontSize: 30, fontWeight: '900', color: colors.text },
  keySmall: { fontSize: 15, fontWeight: '800', color: colors.muted },
});
