import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { driver } from '../api/driver';
import type { Topup } from '../api/types';
import { BRAND, BRAND_INK } from '../config';
import {
  keys,
  useBalance,
  useDriverConfig,
  useFeatures,
  useStreamOpen,
  useTopups,
} from '../data/queries';
import { useT } from '../i18n';
import { t as tr } from '../i18n/dictionary';
import { errorMessage } from '../lib/api-client';
import type { CardProvider } from '../lib/driver-config';
import { dateTime, som, until } from '../lib/format';
import {
  parseTopupAmount,
  PROVIDER_LABELS,
  TOPUP_PRESETS,
  TOPUP_STATUS_TEXT,
  topupPhase,
  topupRefetchMs,
} from '../lib/topup';
import {
  Banner,
  Button,
  Card,
  Choice,
  ErrorState,
  Field,
  Loading,
  Muted,
  Row,
  Title,
} from '../ui/components';
import { haptics } from '../ui/haptics';
import { Screen } from '../ui/screen';
import { colors, space } from '../ui/theme';
import { SupportCard } from '../ui/widgets';

async function openCheckout(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: BRAND_INK,
      controlsColor: BRAND,
      showTitle: true,
      enableBarCollapsing: true,
    });
  } catch {
    Alert.alert(tr('money.topup.checkoutFailed'), tr('money.topup.checkoutFailedText'));
  }
}

/**
 * Card top-up: choose the amount, pay on Payme's or Click's page (opened in an in-app
 * browser), and the screen waits for the provider's confirmation (the API credits the
 * balance once per payment). The stream's `topup.updated` (or the `topup_paid` push, whose
 * tap opens `/topup?id=…`) says when it is paid; until then the screen keeps asking as a
 * fallback, slowly while the stream is up.
 */
export default function TopupScreen() {
  const { t } = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ amount?: string; id?: string }>();
  const config = useDriverConfig();
  const pub = useFeatures();
  const balance = useBalance();
  const history = useTopups();
  const limits = config.topups;
  const providers: CardProvider[] = config.topups.providers.length
    ? config.topups.providers
    : pub.cardProviders;

  const [text, setText] = useState(params.amount ? String(params.amount) : '50000');
  const [problem, setProblem] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(params.id ? String(params.id) : null);
  const startedAt = useRef(Date.now());
  const streamOpen = useStreamOpen();
  // opened again from a `topup_paid` push for another payment
  const paramId = params.id ? String(params.id) : null;
  useEffect(() => {
    if (paramId) setIntentId(paramId);
  }, [paramId]);

  const intent = useQuery({
    queryKey: keys.topup(intentId ?? ''),
    queryFn: () => driver.topupStatus(intentId!),
    enabled: intentId !== null,
    // `topup.updated` (or the push) marks it paid and this stops; asking is the fallback
    refetchInterval: (q) =>
      topupRefetchMs(q.state.data?.status, startedAt.current, Date.now(), streamOpen),
    refetchIntervalInBackground: false,
  });
  const phase = intent.data ? topupPhase(intent.data.status) : null;

  // paid: the balance and the ledger changed
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== 'paid' || !intent.data || announced.current === intent.data.id) return;
    announced.current = intent.data.id;
    haptics.success();
    void qc.invalidateQueries({ queryKey: keys.balance });
    void qc.invalidateQueries({ queryKey: keys.me });
    void qc.invalidateQueries({ queryKey: keys.ledger });
    void qc.invalidateQueries({ queryKey: keys.topups });
  }, [phase, intent.data, qc]);

  const create = useMutation({
    mutationFn: async (provider: CardProvider) => {
      const parsed = parseTopupAmount(text, limits);
      if ('error' in parsed) throw new Error(parsed.error);
      const created = await driver.topup(parsed.amount);
      return { created, provider };
    },
    onSuccess: ({ created, provider }) => {
      startedAt.current = Date.now();
      qc.setQueryData(keys.topup(created.id), created);
      setIntentId(created.id);
      void qc.invalidateQueries({ queryKey: keys.topups });
      const url = created.checkout?.[provider] ?? Object.values(created.checkout ?? {})[0];
      if (url) void openCheckout(url).then(() => void intent.refetch());
      else Alert.alert(t('money.topup.noCheckout'), t('money.topup.noCheckoutText'));
    },
    onError: (error) => {
      haptics.error();
      setProblem(error instanceof Error ? error.message : errorMessage(error));
    },
  });

  const pay = (provider: CardProvider) => {
    const parsed = parseTopupAmount(text, limits);
    if ('error' in parsed) return setProblem(parsed.error);
    setProblem(null);
    create.mutate(provider);
  };

  const again = () => {
    setIntentId(null);
    announced.current = null;
    router.setParams({ id: undefined });
  };

  const current = intent.data ?? null;
  const recent = (history.data ?? []).filter((x) => x.purpose === 'topup').slice(0, 10);

  return (
    <Screen
      keyboard
      title={t('common.screens.topup')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/money'))}
      refreshing={history.isRefetching}
      onRefresh={() => {
        void history.refetch();
        void balance.refetch();
        if (intentId) void intent.refetch();
      }}
    >
      {balance.data ? (
        <Row label={t('money.balance.current')} value={som(balance.data.balance)} strong />
      ) : null}

      {!providers.length ? (
        <>
          <Banner
            tone="warning"
            icon="card"
            title={t('money.topup.notConnected')}
            text={t('money.topup.notConnectedText')}
          />
          <SupportCard text={t('money.topup.supportText')} />
        </>
      ) : intentId && !current && intent.isError ? (
        // opened from the "paid" push or after a restart: the payment is looked up, never
        // replaced by the new top-up form (the driver could pay twice)
        <ErrorState message={errorMessage(intent.error)} onRetry={() => void intent.refetch()} />
      ) : intentId && !current ? (
        <Loading />
      ) : current && phase ? (
        <PaymentState
          topup={current}
          phase={phase}
          checking={intent.isFetching}
          onCheck={() => void intent.refetch()}
          onOpen={(url) => void openCheckout(url).then(() => void intent.refetch())}
          onAgain={again}
          onDone={() => (router.canGoBack() ? router.back() : router.replace('/money'))}
        />
      ) : (
        <Card>
          <Title>{t('money.topup.howMuch')}</Title>
          <Choice
            options={TOPUP_PRESETS.map((v) => ({ value: String(v), label: som(v) }))}
            selected={[text.replace(/\s/g, '')]}
            onToggle={(v) => {
              setText(v);
              setProblem(null);
            }}
          />
          <Field
            label={t('money.topup.amount')}
            value={text}
            onChangeText={(v) => {
              setText(v.replace(/[^\d\s]/g, ''));
              setProblem(null);
            }}
            keyboardType="number-pad"
            maxLength={9}
            error={problem}
            hint={t('money.topup.range', { min: som(limits.min), max: som(limits.max) })}
          />
          {providers.map((p) => (
            <Button
              key={p}
              title={t('money.topup.payVia', { provider: PROVIDER_LABELS[p] ?? p })}
              icon="card"
              big
              loading={create.isPending && create.variables === p}
              disabled={create.isPending}
              onPress={() => pay(p)}
            />
          ))}
          <Muted>{t('money.topup.note')}</Muted>
        </Card>
      )}

      {recent.length ? (
        <Card>
          <Title>{t('money.ledger.cardPayments')}</Title>
          {recent.map((x) => (
            <Row
              key={x.id}
              label={`${dateTime(x.createdAt)} · ${TOPUP_STATUS_TEXT[x.status] ?? x.status}${
                x.provider ? ` · ${PROVIDER_LABELS[x.provider] ?? x.provider}` : ''
              }`}
              value={som(x.amount)}
              tone={x.status === 'paid' ? 'success' : undefined}
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function PaymentState(props: {
  topup: Topup;
  phase: 'waiting' | 'paid' | 'failed';
  checking: boolean;
  onCheck: () => void;
  onOpen: (url: string) => void;
  onAgain: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  const tp = props.topup;
  if (props.phase === 'paid') {
    return (
      <Card style={{ alignItems: 'center' }}>
        <Ionicons name="checkmark-circle" size={72} color={colors.success} />
        <Text style={styles.big}>{som(tp.amount)}</Text>
        <Title>{t('money.topup.paid')}</Title>
        <Button
          title={t('common.actions.done')}
          icon="checkmark"
          big
          onPress={props.onDone}
          style={styles.wide}
        />
      </Card>
    );
  }
  if (props.phase === 'failed') {
    return (
      <Card>
        <Banner
          tone="danger"
          icon="close-circle"
          title={TOPUP_STATUS_TEXT[tp.status] ?? t('money.topup.failed')}
          text={t('money.topup.failedText')}
        />
        <Button title={t('money.topup.payAgain')} icon="refresh" onPress={props.onAgain} />
      </Card>
    );
  }
  const links = Object.entries(tp.checkout ?? {}) as [CardProvider, string][];
  return (
    <Card>
      <View style={styles.waiting}>
        <Ionicons name="time" size={40} color={colors.brand} />
        <View style={{ flex: 1 }}>
          <Title>{t('money.topup.waitingTitle', { amount: som(tp.amount) })}</Title>
          <Muted>{t('money.topup.waitingText', { until: until(dateTime(tp.expiresAt)) })}</Muted>
        </View>
      </View>
      <Button
        title={t('money.topup.check')}
        icon="refresh"
        loading={props.checking}
        onPress={props.onCheck}
      />
      {links.map(([p, url]) => (
        <Button
          key={p}
          title={t('money.topup.openPage', { provider: PROVIDER_LABELS[p] ?? p })}
          icon="open"
          variant="secondary"
          onPress={() => props.onOpen(url)}
        />
      ))}
      <Button title={t('money.topup.otherAmount')} variant="ghost" onPress={props.onAgain} />
    </Card>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 36, fontWeight: '900', color: colors.text },
  wide: { alignSelf: 'stretch' },
  waiting: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
});
