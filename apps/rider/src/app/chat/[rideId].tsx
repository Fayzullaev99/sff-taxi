import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chatEndpoints, chatKeys, useConversation } from '../../api/chat-api';
import { describeError } from '../../api/client';
import { useLiveRides } from '../../api/realtime';
import { useT } from '../../i18n';
import {
  type ChatMessage,
  chatStatusText,
  composerState,
  type Conversation,
  mergeMessages,
  messageTime,
  receiptText,
  withMessage,
} from '../../lib/chat';
import { setOpenChat } from '../../lib/chat-open';
import { KeyboardAvoider } from '../../ui/KeyboardAvoider';
import { Banner, Chip, IconButton, MAX_FONT_SCALE, T } from '../../ui/primitives';
import { ErrorView, LoadingView } from '../../ui/states';
import { colors, radius, space } from '../../ui/theme';

/**
 * The ride chat with the driver: messages and quick replies ("Chiqyapman", "5 daqiqada
 * chiqaman"…), live over the stream, read receipts. Open from the driver's assignment until
 * 30 minutes after the ride, then read-only. Calls stay on the phone button (the number is
 * shown during the ride).
 */
export default function ChatScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const live = useLiveRides(true);
  const conversation = useConversation(rideId, { open: true, live });
  const [local, setLocal] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const c = conversation.data;

  // a chat push for this ride is not shown as a banner while it is on screen
  useEffect(() => {
    setOpenChat(rideId ?? null);
    return () => setOpenChat(null);
  }, [rideId]);

  // what the driver wrote is read once it is on screen
  const unread = c?.unread ?? 0;
  useEffect(() => {
    if (!rideId || unread <= 0) return;
    void chatEndpoints
      .read(rideId)
      .then(() =>
        queryClient.setQueryData<Conversation>(chatKeys.conversation(rideId), (old) =>
          old ? { ...old, unread: 0 } : old,
        ),
      )
      .catch(() => undefined);
  }, [rideId, unread, queryClient]);

  const messages = useMemo(() => mergeMessages(c?.messages ?? [], local), [c?.messages, local]);
  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = async (
    body: { text: string | null; quickReply: string | null },
    retry?: ChatMessage,
  ) => {
    if (!rideId) return;
    const clientMessageId = retry?.clientMessageId ?? Crypto.randomUUID();
    const pending: ChatMessage = {
      id: `local-${clientMessageId}`,
      rideId,
      authorRole: 'rider',
      mine: true,
      text: body.text ?? c?.quickReplies.find((q) => q.key === body.quickReply)?.text ?? '',
      quickReply: body.quickReply,
      readAt: null,
      createdAt: new Date().toISOString(),
      pending: true,
      clientMessageId,
    };
    setError(null);
    setLocal((l) => [...l.filter((m) => m.clientMessageId !== clientMessageId), pending]);
    try {
      const sent = await chatEndpoints.send(rideId, { ...body, clientMessageId });
      queryClient.setQueryData<Conversation>(chatKeys.conversation(rideId), (old) =>
        old ? withMessage(old, sent) : old,
      );
      setLocal((l) => l.filter((m) => m.clientMessageId !== clientMessageId));
    } catch (e) {
      setError(describeError(e));
      setLocal((l) =>
        l.map((m) =>
          m.clientMessageId === clientMessageId ? { ...m, pending: false, failed: true } : m,
        ),
      );
    }
  };

  if (!c) {
    return conversation.isError ? (
      <ErrorView error={conversation.error} onRetry={() => void conversation.refetch()} />
    ) : (
      <LoadingView />
    );
  }
  const composer = composerState(text, c.maxLength);
  const status = chatStatusText(c);
  const lastMine = [...messages].reverse().find((m) => m.mine);

  return (
    <KeyboardAvoider style={styles.root} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          title: c.counterpart.name
            ? t('ride.chat.driverTitle', { name: c.counterpart.name })
            : t('ride.chat.driver'),
        }}
      />
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      >
        {!messages.length ? (
          <T variant="small" color={colors.textMuted} align="center">
            {t('ride.chat.emptyHint')}
          </T>
        ) : null}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            message={m}
            receipt={m === lastMine ? receiptText(m) : m.failed ? receiptText(m) : null}
            onRetry={
              m.failed
                ? () =>
                    void send({ text: m.quickReply ? null : m.text, quickReply: m.quickReply }, m)
                : undefined
            }
          />
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space(2)) }]}>
        {error ? <Banner tone="danger" message={error} /> : null}
        {status ? (
          <T variant="small" color={colors.textMuted}>
            {status}
          </T>
        ) : null}
        {c.writable ? (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quick}
            >
              {c.quickReplies.map((q) => (
                <Chip
                  key={q.key}
                  label={q.text}
                  selected={false}
                  onPress={() => void send({ text: null, quickReply: q.key })}
                />
              ))}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder={t('ride.chat.placeholder')}
                placeholderTextColor={colors.placeholder}
                multiline
                maxLength={c.maxLength + 50}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                accessibilityLabel={t('ride.chat.message')}
              />
              <IconButton
                name="send"
                label={t('common.actions.send')}
                size={48}
                background={composer.canSend ? colors.brand : colors.surface}
                color={composer.canSend ? colors.onBrand : colors.textFaint}
                onPress={() => {
                  if (!composer.canSend) return;
                  const body = { text: text.trim(), quickReply: null };
                  setText('');
                  void send(body);
                }}
              />
            </View>
            {composer.tooLong ? (
              <T variant="small" color={colors.danger}>
                {t('ride.chat.tooLong', { max: c.maxLength })}
              </T>
            ) : null}
          </>
        ) : null}
      </View>
    </KeyboardAvoider>
  );
}

function Bubble({
  message,
  receipt,
  onRetry,
}: {
  message: ChatMessage;
  receipt: string | null;
  onRetry?: () => void;
}) {
  const { t } = useT();
  const mine = message.mine;
  return (
    <Pressable
      disabled={!onRetry}
      onPress={onRetry}
      accessibilityRole={onRetry ? 'button' : 'text'}
      accessibilityLabel={t('ride.chat.bubbleA11y', {
        author: mine ? t('ride.chat.you') : t('ride.chat.driver'),
        text: message.text,
        time: messageTime(message.createdAt),
      })}
      style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}
    >
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          message.failed ? styles.bubbleFailed : null,
        ]}
      >
        <T variant="body" color={mine ? colors.onBrand : colors.text}>
          {message.text}
        </T>
        <T variant="caption" color={mine ? colors.onBrand : colors.textMuted} align="right">
          {messageTime(message.createdAt)}
        </T>
      </View>
      {receipt ? (
        <T variant="caption" color={message.failed ? colors.danger : colors.textMuted}>
          {receipt}
        </T>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  list: { padding: space(4), gap: space(2) },
  bubbleRow: { maxWidth: '82%', gap: 2 },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: 2,
  },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: radius.sm },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: radius.sm },
  bubbleFailed: { opacity: 0.6 },
  footer: {
    paddingHorizontal: space(4),
    paddingTop: space(2),
    gap: space(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  quick: { gap: space(2), paddingVertical: space(1) },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space(2) },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space(3),
    paddingTop: space(3),
    paddingBottom: space(3),
    fontSize: 16,
    color: colors.text,
  },
});
