import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { formatDateTime } from '../lib/format';
import { SCHEDULE_DISPATCH_BEFORE_MIN, scheduleSlots } from '../lib/schedule';
import { RadioMark, T } from '../ui/primitives';
import { Sheet } from '../ui/Sheet';
import { colors, space } from '../ui/theme';

/**
 * Picks the pickup time of a ride for later: quarter hours from ~35 minutes to 24 hours
 * ahead (the API's window), in Tashkent time.
 */
export function ScheduleSheet({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  value: string | null;
  onClose: () => void;
  onPick: (iso: string) => void;
}) {
  // recomputed each time the sheet opens, so the first slot is always still valid
  const slots = useMemo(
    () => (visible ? scheduleSlots(new Date()).map((d) => d.toISOString()) : []),
    [visible],
  );
  const now = new Date();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <T variant="h2" accessibilityRole="header">
          Qachon olib ketamiz?
        </T>
        <T variant="small" color={colors.textMuted}>
          Haydovchi qidiruvi {SCHEDULE_DISPATCH_BEFORE_MIN} daqiqa oldin boshlanadi. Narx shu vaqt
          uchun hisoblanadi va o‘zgarmaydi.
        </T>
      </View>
      <FlatList
        data={slots}
        keyExtractor={(s) => s}
        style={styles.list}
        initialNumToRender={16}
        accessibilityRole="radiogroup"
        renderItem={({ item }) => {
          const selected = item === value;
          const label = formatDateTime(item, now);
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={label}
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
            >
              <T variant={selected ? 'bodyStrong' : 'body'} style={styles.flex}>
                {label}
              </T>
              <RadioMark selected={selected} />
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { padding: space(4), paddingTop: space(6), gap: space(1.5) },
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(4),
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { backgroundColor: colors.surface },
  flex: { flex: 1 },
});
