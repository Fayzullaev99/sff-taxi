import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { driver } from '../api/driver';
import type { Appeal } from '../api/types';
import { keys, useAppeals, useDriverMe } from '../data/queries';
import { useT } from '../i18n';
import { errorMessage } from '../lib/api-client';
import { dateTime } from '../lib/format';
import {
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Muted,
  Title,
} from '../ui/components';
import { haptics } from '../ui/haptics';
import { Screen } from '../ui/screen';
import { colors, space } from '../ui/theme';
import { SupportCard } from '../ui/widgets';

const MIN = 5;
const MAX = 1000;

/**
 * A rejected or blocked driver asks operators to review the decision (`POST
 * /v1/driver/appeals`): one open appeal at a time; the answer shows here. The "transparent
 * rules, human appeal" promise (market analysis §1.5).
 */
export default function Appeals() {
  const { t } = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useDriverMe();
  const appeals = useAppeals();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => driver.appeal(text.trim()),
    onSuccess: (appeal) => {
      haptics.success();
      setText('');
      qc.setQueryData<Appeal[]>(keys.appeals, (list) => [appeal, ...(list ?? [])]);
    },
    onError: (error) => {
      haptics.error();
      setProblem(errorMessage(error));
      void qc.invalidateQueries({ queryKey: keys.appeals });
    },
  });

  const submit = () => {
    if (text.trim().length < MIN) return setProblem(t('apply.appeals.tooShort'));
    setProblem(null);
    send.mutate();
  };

  const d = me.data;
  if (!d || appeals.isPending) return <Loading />;
  const list = appeals.data ?? [];
  const open = list.find((a) => a.status === 'open') ?? null;
  const allowed = d.status === 'rejected' || d.status === 'blocked';

  return (
    <Screen
      keyboard
      title={t('common.screens.appeals')}
      refreshing={appeals.isRefetching}
      onRefresh={() => void appeals.refetch()}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/status'))}
    >
      {d.statusReason ? (
        <Banner
          tone="danger"
          icon="information-circle"
          title={
            d.status === 'blocked'
              ? t('apply.appeals.blockReason')
              : t('apply.appeals.rejectReason')
          }
          text={d.statusReason}
        />
      ) : null}

      {!allowed ? (
        <Banner tone="success" icon="checkmark-circle" text={t('apply.appeals.notNeeded')} />
      ) : open ? (
        <Banner
          tone="info"
          icon="hourglass"
          title={t('apply.appeals.pendingTitle')}
          text={t('apply.appeals.pendingText')}
        />
      ) : (
        <Card>
          <Title>{t('apply.appeals.whatIsWrong')}</Title>
          <Muted>{t('apply.appeals.explain')}</Muted>
          <Field
            label={t('apply.appeals.textLabel')}
            value={text}
            onChangeText={(v) => {
              setText(v.slice(0, MAX));
              setProblem(null);
            }}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={styles.textarea}
            placeholder={t('apply.appeals.placeholder')}
            error={problem}
            hint={`${text.trim().length}/${MAX}`}
          />
          <Button
            title={t('common.actions.send')}
            icon="send"
            big
            loading={send.isPending}
            disabled={text.trim().length < MIN}
            onPress={submit}
          />
        </Card>
      )}

      {appeals.error && !list.length ? (
        <ErrorState message={errorMessage(appeals.error)} onRetry={() => void appeals.refetch()} />
      ) : list.length ? (
        list.map((a) => <AppealCard key={a.id} appeal={a} />)
      ) : allowed ? null : (
        <EmptyState icon="chatbubbles-outline" title={t('apply.appeals.empty')} />
      )}

      <Button
        title={t('common.screens.documents')}
        icon="documents"
        variant="secondary"
        onPress={() => router.push('/documents')}
      />
      <SupportCard text={t('apply.appeals.officeText')} />
    </Screen>
  );
}

function AppealCard({ appeal }: { appeal: Appeal }) {
  const { t } = useT();
  const resolved = appeal.status === 'resolved';
  return (
    <Card>
      <View style={styles.head}>
        <Ionicons
          name={resolved ? 'chatbox-ellipses' : 'hourglass'}
          size={24}
          color={resolved ? colors.success : colors.brand}
        />
        <Text style={styles.when}>{dateTime(appeal.createdAt)}</Text>
        <Chip
          label={resolved ? t('apply.appeals.answered') : t('apply.appeals.reviewing')}
          tone={resolved ? 'success' : 'brand'}
        />
      </View>
      <Text style={styles.text}>{appeal.text}</Text>
      {resolved && appeal.resolution ? (
        <View style={styles.answer}>
          <Text style={styles.answerTitle}>
            {appeal.resolvedAt
              ? t('apply.appeals.operatorAnswerAt', { time: dateTime(appeal.resolvedAt) })
              : t('apply.appeals.operatorAnswer')}
          </Text>
          <Text style={styles.text}>{appeal.resolution}</Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  textarea: { minHeight: 140, paddingTop: space.md, fontSize: 17 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  when: { flex: 1, color: colors.muted, fontSize: 14, fontWeight: '700' },
  text: { color: colors.text, fontSize: 16, lineHeight: 22 },
  answer: {
    gap: space.xs,
    padding: space.md,
    borderRadius: 12,
    backgroundColor: colors.successSoft,
  },
  answerTitle: { color: colors.success, fontWeight: '800', fontSize: 14 },
});
