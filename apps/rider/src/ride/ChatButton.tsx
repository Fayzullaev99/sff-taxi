import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useConversation } from '../api/chat-api';
import { useLiveRides } from '../api/realtime';
import { badgeText } from '../lib/chat';
import { Icon, T } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';

/**
 * "Haydovchiga yozish" on the ride screen, with the unread badge: opens the ride chat. Kept
 * up to date by the stream (`chat.message`) or a slow poll.
 */
export function ChatButton({
  rideId,
  afterRide = false,
}: {
  rideId: string;
  /** On a finished ride: shown only while the chat is open or has messages. */
  afterRide?: boolean;
}) {
  // the stream (shared with the ride screen) refetches the conversation on chat events
  const live = useLiveRides(true);
  const conversation = useConversation(rideId, { open: false, live });
  const badge = badgeText(conversation.data?.unread ?? 0);
  const c = conversation.data;
  if (afterRide && (!c || (!c.writable && !c.messages.length))) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Haydovchiga yozish${badge ? `, ${badge} ta yangi xabar` : ''}`}
      onPress={() => router.push({ pathname: '/chat/[rideId]', params: { rideId } })}
      style={({ pressed }) => [
        styles.button,
        pressed ? { backgroundColor: colors.surfacePressed } : null,
      ]}
    >
      <Icon name="chatbubble-ellipses-outline" size={20} color={colors.ink} />
      <T variant="bodyStrong" style={styles.flex}>
        Haydovchiga yozish
      </T>
      {badge ? (
        <View style={styles.badge}>
          <T variant="smallStrong" color={colors.onInk}>
            {badge}
          </T>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2.5),
    minHeight: 52,
    paddingHorizontal: space(3.5),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  flex: { flex: 1 },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
});
