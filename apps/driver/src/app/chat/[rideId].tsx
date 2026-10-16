import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chatApi, chatKeys, useConversation } from '../../api/chat';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/api-client';
import {
  type ChatMessage,
  chatStatusText,
  composerState,
  type Conversation,
  mergeMessages,
  messageTime,
  newClientMessageId,
  receiptText,
  withMessage,
} from '../../lib/chat';
import { setOpenChat } from '../../notifications/chat-open';
import { Banner, ErrorState, Loading } from '../../ui/components';
import { useAndroidKeyboardHeight } from '../../ui/keyboard';
import { colors, radius, space, TOUCH } from '../../ui/theme';

/**
 * The ride chat with the rider: big quick replies for one-handed use in the car ("Yetib
 * keldim", "Podyezd oldidaman"…), typed messages when parked, live over the stream, read
 * receipts. Open from the assignment until 30 minutes after the ride, then read-only.
 */
export default function DriverChat() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const router = useRouter();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const keyboard = useAndroidKeyboardHeight();
  const qc = useQueryClient();
  const conversation = useConversation(rideId, true);
  const [local, setLocal] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const c = conversation.data;

  useEffect(() => {
    setOpenChat(rideId ?? null);
    return () => setOpenChat(null);
  }, [rideId]);

  const unread = c?.unread ?? 0;
  useEffect(() => {
    if (!rideId || unread <= 0) return;
    void chatApi
      .read(rideId)
      .then(() =>
        qc.setQueryData<Conversation>(chatKeys.conversation(rideId), (old) =>
          old ? { ...old, unread: 0 } : old,
        ),
      )
      .catch(() => undefined);
  }, [rideId, unread, qc]);

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
    const clientMessageId = retry?.clientMessageId ?? newClientMessageId();
    const pending: ChatMessage = {
      id: `local-${clientMessageId}`,
      rideId,
      authorRole: 'driver',
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
      const sent = await chatApi.send(rideId, { ...body, clientMessageId });
      qc.setQueryData<Conversation>(chatKeys.conversation(rideId), (old) =>
        old ? withMessage(old, sent) : old,
      );
      setLocal((l) => l.filter((m) => m.clientMessageId !== clientMessageId));
    } catch (e) {
      setError(errorMessage(e));
      setLocal((l) =>
        l.map((m) =>
          m.clientMessageId === clientMessageId ? { ...m, pending: false, failed: true } : m,
        ),
      );
    }
  };

  if (!c) {
    return conversation.isError ? (
      <View style={[styles.root, { paddingTop: insets.top + space.lg }]}>
        <ErrorState
          message={errorMessage(conversation.error)}
          onRetry={() => void conversation.refetch()}
        />
      </View>
    ) : (
      <Loading />
    );
  }
  const composer = composerState(text, c.maxLength);
  const status = chatStatusText(c);
  const lastMine = [...messages].reverse().find((m) => m.mine);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.actions.back')}
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.back}
        >
          <Ionicons name="arrow-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {c.counterpart.name
            ? t('ride.chat.riderNamed', { name: c.counterpart.name })
            : t('ride.chat.rider')}
        </Text>
      </View>
      <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.list}>
        {!messages.length ? <Text style={styles.hint}>{t('ride.chat.hint')}</Text> : null}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            message={m}
            receipt={m === lastMine || m.failed ? receiptText(m) : null}
            onRetry={
              m.failed
                ? () =>
                    void send({ text: m.quickReply ? null : m.text, quickReply: m.quickReply }, m)
                : undefined
            }
          />
        ))}
      </ScrollView>
      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, space.sm) + (keyboard ? keyboard : 0) },
        ]}
      >
        {error ? <Banner tone="danger" icon="alert-circle" text={error} /> : null}
        {status ? <Text style={styles.status}>{status}</Text> : null}
        {c.writable ? (
          <>
            <View style={styles.quick}>
              {c.quickReplies.map((q) => (
                <Pressable
                  key={q.key}
                  accessibilityRole="button"
                  onPress={() => void send({ text: null, quickReply: q.key })}
                  style={({ pressed }) => [styles.quickButton, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.quickText}>{q.text}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder={t('ride.chat.placeholder')}
                placeholderTextColor={colors.muted}
                multiline
                maxLength={c.maxLength + 50}
                accessibilityLabel={t('ride.chat.message')}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.actions.send')}
                accessibilityState={{ disabled: !composer.canSend }}
                onPress={() => {
                  if (!composer.canSend) return;
                  const body = { text: text.trim(), quickReply: null };
                  setText('');
                  void send(body);
                }}
                style={[styles.send, !composer.canSend && { opacity: 0.4 }]}
              >
                <Ionicons name="send" size={24} color={colors.onBrand} />
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </KeyboardAvoidingView>
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
      accessibilityLabel={t('ride.chat.bubbleA11y', {
        who: t(mine ? 'ride.chat.you' : 'ride.chat.rider'),
        text: message.text,
        time: messageTime(message.createdAt),
      })}
      style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}
    >
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          message.failed && { opacity: 0.6 },
        ]}
      >
        <Text style={[styles.bubbleText, mine && { color: colors.onBrand }]}>{message.text}</Text>
        <Text style={[styles.time, mine && { color: colors.onBrand }]}>
          {messageTime(message.createdAt)}
        </Text>
      </View>
      {receipt ? (
        <Text style={[styles.receipt, message.failed && { color: colors.danger }]}>{receipt}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '800' },
  list: { padding: space.lg, gap: space.sm },
  hint: { color: colors.muted, fontSize: 16, textAlign: 'center' },
  bubbleRow: { maxWidth: '82%', gap: 2 },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: radius.sm },
  bubbleTheirs: { backgroundColor: colors.surfaceRaised, borderBottomLeftRadius: radius.sm },
  bubbleText: { color: colors.text, fontSize: 18 },
  time: { color: colors.muted, fontSize: 12, textAlign: 'right' },
  receipt: { color: colors.muted, fontSize: 12 },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  status: { color: colors.muted, fontSize: 14 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  quickButton: {
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  quickText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    minHeight: TOUCH,
    maxHeight: 140,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    fontSize: 17,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  send: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
