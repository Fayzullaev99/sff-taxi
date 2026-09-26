import * as Haptics from 'expo-haptics';

/**
 * Feedback the driver can feel without looking at the phone: accepted an offer, arrived,
 * started, completed, and refusals. Never throws (no vibrator, web).
 */
export const haptics = {
  /** A step done: accepted, arrived, started, completed. */
  success: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  /** The action was refused. */
  error: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
  /** Something needs attention (offer taken by someone else, ride cancelled). */
  warning: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
  /** A firm tap: shift on/off, opening a confirmation. */
  tap: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  /** Choosing among options. */
  select: () => void Haptics.selectionAsync().catch(() => {}),
};
