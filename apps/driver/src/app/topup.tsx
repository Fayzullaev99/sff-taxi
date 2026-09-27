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
import { errorMessage } from '../lib/api-client';
import type { CardProvider } from '../lib/driver-config';
import { dateTime, som } from '../lib/format';
import {
  parseTopupAmount,
  PROVIDER_LABELS,
  TOPUP_PRESETS,
  TOPUP_STATUS_TEXT,
  topupPhase,
  topupRefetchMs,
} from '../lib/topup';
import { Banner, Button, Card, Choice, Field, Muted, Row, Title } from '../ui/components';
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
    Alert.alert('To‘lov sahifasi ochilmadi', 'Telefoningizda brauzer bormi, tekshiring.');
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
      else Alert.alert('To‘lov sahifasi yo‘q', 'Birozdan so‘ng qayta urinib ko‘ring.');
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
  const recent = (history.data ?? []).filter((t) => t.purpose === 'topup').slice(0, 10);

  return (
    <Screen
      keyboard
      title="Balansni to‘ldirish"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/money'))}
      refreshing={history.isRefetching}
      onRefresh={() => {
        void history.refetch();
        void balance.refetch();
        if (intentId) void intent.refetch();
      }}
    >
      {balance.data ? (
        <Row label="Hozirgi balans" value={som(balance.data.balance)} strong />
      ) : null}

      {!providers.length ? (
        <>
          <Banner
            tone="warning"
            icon="card"
            title="Karta orqali to‘lov hali ulanmagan"
            text="Balansni ofisda naqd to‘ldiring: operator darhol yozib qo‘yadi."
          />
          <SupportCard text="Ofisga kelib naqd to‘ldiring yoki qo‘ng‘iroq qiling." />
        </>
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
          <Title>Qancha to‘ldirasiz?</Title>
          <Choice
            options={TOPUP_PRESETS.map((v) => ({ value: String(v), label: som(v) }))}
            selected={[text.replace(/\s/g, '')]}
            onToggle={(v) => {
              setText(v);
              setProblem(null);
            }}
          />
          <Field
            label="Summa (so‘m)"
            value={text}
            onChangeText={(v) => {
              setText(v.replace(/[^\d\s]/g, ''));
              setProblem(null);
            }}
            keyboardType="number-pad"
            maxLength={9}
            error={problem}
            hint={`${som(limits.min)} dan ${som(limits.max)} gacha`}
          />
          {providers.map((p) => (
            <Button
              key={p}
              title={`${PROVIDER_LABELS[p] ?? p} orqali to‘lash`}
              icon="card"
              big
              loading={create.isPending && create.variables === p}
              disabled={create.isPending}
              onPress={() => pay(p)}
            />
          ))}
          <Muted>
            To‘lov sahifasi ochiladi. To‘laganingizdan so‘ng shu yerga qayting — balans avtomatik
            to‘ldiriladi. To‘lov 30 daqiqa ichida qilinishi kerak.
          </Muted>
        </Card>
      )}

      {recent.length ? (
        <Card>
          <Title>Karta to‘lovlari</Title>
          {recent.map((t) => (
            <Row
              key={t.id}
              label={`${dateTime(t.createdAt)} · ${TOPUP_STATUS_TEXT[t.status] ?? t.status}${
                t.provider ? ` · ${PROVIDER_LABELS[t.provider] ?? t.provider}` : ''
              }`}
              value={som(t.amount)}
              tone={t.status === 'paid' ? 'success' : undefined}
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
  const t = props.topup;
  if (props.phase === 'paid') {
    return (
      <Card style={{ alignItems: 'center' }}>
        <Ionicons name="checkmark-circle" size={72} color={colors.success} />
        <Text style={styles.big}>{som(t.amount)}</Text>
        <Title>Balans to‘ldirildi</Title>
        <Button title="Tayyor" icon="checkmark" big onPress={props.onDone} style={styles.wide} />
      </Card>
    );
  }
  if (props.phase === 'failed') {
    return (
      <Card>
        <Banner
          tone="danger"
          icon="close-circle"
          title={TOPUP_STATUS_TEXT[t.status] ?? 'To‘lov o‘tmadi'}
          text="Pul yechilmagan bo‘lsa, qayta urinib ko‘ring. Yechilgan bo‘lsa, ofisga murojaat qiling."
        />
        <Button title="Qayta to‘lash" icon="refresh" onPress={props.onAgain} />
      </Card>
    );
  }
  const links = Object.entries(t.checkout ?? {}) as [CardProvider, string][];
  return (
    <Card>
      <View style={styles.waiting}>
        <Ionicons name="time" size={40} color={colors.brand} />
        <View style={{ flex: 1 }}>
          <Title>{som(t.amount)} — to‘lov kutilmoqda</Title>
          <Muted>
            To‘lov sahifasida to‘lang. Tasdiq kelishi bilan balans to‘ldiriladi (odatda bir necha
            soniya). Muddati: {dateTime(t.expiresAt)} gacha.
          </Muted>
        </View>
      </View>
      <Button
        title="To‘landimi? Tekshirish"
        icon="refresh"
        loading={props.checking}
        onPress={props.onCheck}
      />
      {links.map(([p, url]) => (
        <Button
          key={p}
          title={`${PROVIDER_LABELS[p] ?? p} sahifasini ochish`}
          icon="open"
          variant="secondary"
          onPress={() => props.onOpen(url)}
        />
      ))}
      <Button title="Boshqa summa" variant="ghost" onPress={props.onAgain} />
    </Card>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 36, fontWeight: '900', color: colors.text },
  wide: { alignSelf: 'stretch' },
  waiting: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
});
