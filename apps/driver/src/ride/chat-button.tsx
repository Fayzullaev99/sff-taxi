import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useConversation } from '../api/chat';
import { useT } from '../i18n';
import { badgeText } from '../lib/chat';
import { colors, radius, space, TOUCH } from '../ui/theme';

/** "Yo‘lovchiga yozish" with the unread badge: opens the ride chat. */
export function ChatButton({ rideId }: { rideId: string }) {
  const router = useRouter();
  const { t } = useT();
  const conversation = useConversation(rideId, false);
  const badge = badgeText(conversation.data?.unread ?? 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? t('ride.chat.writeA11y', { badge }) : t('ride.chat.write')}
      onPress={() => router.push({ pathname: '/chat/[rideId]', params: { rideId } })}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name="chatbubble-ellipses" size={22} color={colors.text} />
      <Text style={styles.text}>{t('ride.chat.write')}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800' },
  badge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  badgeText: { color: colors.onDanger, fontSize: 14, fontWeight: '900' },
});
