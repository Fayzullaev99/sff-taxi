import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { driver } from '../../api/driver';
import { keys, useBalance, useDriverConfig, useEarnings, useFeatures } from '../../data/queries';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/api-client';
import { tashkentToday } from '../../lib/application';
import { passesOnSale } from '../../lib/driver-config';
import { dateTime, digits, LEDGER_KINDS, som } from '../../lib/format';
import { balanceStatus, passAdvice, passBreakEven, passLabel, promoStatus } from '../../lib/money';
import {
  Banner,
  Button,
  Card,
  Choice,
  ErrorState,
  Loading,
  Muted,
  Row,
  Title,
} from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { Screen } from '../../ui/screen';
import { colors, space } from '../../ui/theme';
import { TopUpCard } from '../../ui/widgets';

/**
 * Money, transparently: balance and what it allows, top-up by card, the fee in force (0%
 * promo, then the capped commission — the API's current rules), passes, earnings for today
 * or this week with the tax shown separately, and the latest ledger entries (card-ride
 * fares credited and payouts included).
 */
export default function Money() {
  const { t } = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const balance = useBalance();
  const earnings = useEarnings(period);
  const config = useDriverConfig();
  const features = useFeatures();
  const billing = config.billing;

  const buy = useMutation({
    mutationFn: (kind: 'day' | 'week') => driver.buyPass(kind),
    onSuccess: (pass) => {
      haptics.success();
      Alert.alert(
        t('money.passes.bought'),
        t('money.passes.boughtText', { pass: passLabel(pass), balance: som(pass.balance) }),
      );
      void qc.invalidateQueries({ queryKey: keys.balance });
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.passes });
    },
    onError: (error) => {
      haptics.error();
      Alert.alert(t('money.passes.buyFailed'), errorMessage(error));
    },
  });

  if (balance.isPending) return <Loading />;
  if (!balance.data) {
    return (
      <ErrorState message={errorMessage(balance.error)} onRetry={() => void balance.refetch()} />
    );
  }
  const b = balance.data;
  const status = balanceStatus(b.balance, b.minBalance);
  const promo = promoStatus(tashkentToday(), billing);
  const advice = passAdvice(promo, b.activePass !== null);
  const byCard = features.features.cardPayments || config.topups.providers.length > 0;
  const passes = passesOnSale(billing);
  const e = earnings.data;
  const hasCardMoney = b.entries.some((x) => x.kind === 'card_fare' || x.kind === 'payout');

  const confirmBuy = (kind: 'day' | 'week') => {
    const price = kind === 'day' ? billing.passDay : billing.passWeek;
    Alert.alert(
      kind === 'day' ? t('money.passes.day') : t('money.passes.week'),
      t('money.passes.confirmText', { price: som(price), tax: billing.taxPercent }),
      [
        { text: t('common.actions.cancel'), style: 'cancel' },
        { text: t('money.passes.buy'), onPress: () => buy.mutate(kind) },
      ],
    );
  };

  return (
    <Screen
      title={t('money.earnings.title')}
      refreshing={balance.isRefetching}
      onRefresh={() => {
        void balance.refetch();
        void earnings.refetch();
        void qc.invalidateQueries({ queryKey: keys.driverConfig });
      }}
    >
      <Card style={{ alignItems: 'center' }}>
        <Text style={styles.label}>{t('money.balance.label')}</Text>
        <Text
          style={[
            styles.balance,
            {
              color:
                status.level === 'ok'
                  ? colors.text
                  : status.level === 'low'
                    ? colors.warning
                    : colors.danger,
            },
          ]}
        >
          {b.balance < 0 ? '−' : ''}
          {digits(b.balance)} <Text style={styles.unit}>{t('common.units.som')}</Text>
        </Text>
        <Muted center>{t('money.balance.hint', { min: som(b.minBalance) })}</Muted>
        {byCard && status.canWork && status.level === 'ok' ? (
          <Button
            title={t('money.balance.topUpByCard')}
            icon="card"
            variant="secondary"
            onPress={() => router.push('/topup')}
            style={{ alignSelf: 'stretch' }}
          />
        ) : null}
      </Card>

      {!status.canWork || status.level === 'low' ? <TopUpCard shortBy={status.shortBy} /> : null}

      <Banner
        tone={promo.active ? 'success' : 'info'}
        icon="pricetag"
        title={
          promo.active
            ? t('money.rules.promoTitle', { count: promo.daysLeft })
            : t('money.rules.commission')
        }
        text={promo.text}
      />

      <Card>
        <Title>{t('money.rules.title')}</Title>
        <Row
          label={t('money.rules.cityCommission')}
          value={promo.active ? t('money.rules.promoValue') : `${billing.commissionPercent}%`}
        />
        <Row label={t('common.commissionNote.daily_cap')} value={som(billing.dailyCap)} />
        <Row label={t('common.commissionNote.weekly_cap')} value={som(billing.weeklyCap)} />
        <Row
          label={t('common.screens.intercity')}
          value={t('money.rules.intercityValue', {
            percent: billing.intercityPercent,
            cap: som(billing.intercityTripCap),
          })}
        />
        <Row label={t('money.rules.turnoverTax')} value={`${billing.taxPercent}%`} />
        <Row label={t('money.balance.minimum')} value={som(billing.minBalance)} />
      </Card>

      {passes ? (
        <Card>
          <Title>{t('money.passes.title')}</Title>
          {b.activePass ? (
            <Banner tone="success" icon="checkmark-circle" text={passLabel(b.activePass)} />
          ) : (
            <Muted>
              {t('money.passes.hint', {
                price: som(billing.passDay),
                breakEven: som(passBreakEven('day', billing)),
              })}
            </Muted>
          )}
          {advice ? <Muted>{advice}</Muted> : null}
          <View style={styles.pair}>
            <Button
              title={t('money.passes.dayButton', { price: som(billing.passDay) })}
              variant="secondary"
              disabled={promo.active || buy.isPending}
              loading={buy.isPending && buy.variables === 'day'}
              onPress={() => confirmBuy('day')}
              style={{ flex: 1 }}
            />
            <Button
              title={t('money.passes.weekButton', { price: som(billing.passWeek) })}
              variant="secondary"
              disabled={promo.active || buy.isPending}
              loading={buy.isPending && buy.variables === 'week'}
              onPress={() => confirmBuy('week')}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : null}

      <Card>
        <Choice
          options={[
            { value: 'day' as const, label: t('common.time.today') },
            { value: 'week' as const, label: t('money.earnings.thisWeek') },
          ]}
          selected={[period]}
          onToggle={setPeriod}
        />
        {e ? (
          <>
            <Row label={t('common.screens.rides')} value={String(e.rides)} />
            {e.intercityBookings ? (
              <Row
                label={t('money.earnings.intercityPassengers')}
                value={String(e.intercityBookings)}
              />
            ) : null}
            <Row label={t('money.earnings.fares')} value={som(e.fares)} />
            <Row label={t('money.earnings.cash')} value={som(e.cash)} />
            {e.fares - e.cash - (e.promoCompensation ?? 0) > 0 ? (
              <Row
                label={t('money.earnings.card')}
                value={som(e.fares - e.cash - (e.promoCompensation ?? 0))}
              />
            ) : null}
            {(e.tipsCard ?? 0) > 0 ? (
              <Row label={t('money.earnings.tipsCard')} value={som(e.tipsCard!)} tone="success" />
            ) : null}
            {(e.tipsCash ?? 0) > 0 ? (
              <Row label={t('money.earnings.tipsCash')} value={som(e.tipsCash!)} />
            ) : null}
            {(e.promoCompensation ?? 0) > 0 ? (
              <Row
                label={t('money.earnings.promoCompensation')}
                value={som(e.promoCompensation!)}
                tone="success"
              />
            ) : null}
            <Row label={t('money.earnings.commission')} value={som(-e.commission)} />
            <Row label={t('money.earnings.tax', { tax: billing.taxPercent })} value={som(-e.tax)} />
            <View style={styles.divider} />
            <Row label={t('money.earnings.net')} value={som(e.net)} strong tone="success" />
            <Muted>{t('money.earnings.taxNote', { tax: billing.taxPercent })}</Muted>
          </>
        ) : earnings.isPending ? (
          <Loading />
        ) : (
          <ErrorState
            message={errorMessage(earnings.error)}
            onRetry={() => void earnings.refetch()}
          />
        )}
      </Card>

      <Card>
        <Title>{t('money.ledger.recent')}</Title>
        {b.entries.length === 0 ? <Muted>{t('money.ledger.empty')}</Muted> : null}
        {b.entries.slice(0, 8).map((x) => (
          <Row
            key={x.id}
            label={`${LEDGER_KINDS[x.kind] ?? x.kind} · ${dateTime(x.createdAt)}`}
            value={`${x.amount > 0 ? '+' : ''}${som(x.amount)}`}
            tone={x.amount > 0 ? 'success' : undefined}
          />
        ))}
        {hasCardMoney ? <Muted>{t('money.ledger.cardNote')}</Muted> : null}
        <Button
          title={t('money.ledger.all')}
          icon="list"
          variant="secondary"
          onPress={() => router.push('/ledger')}
        />
        {byCard ? (
          <Button
            title={t('money.ledger.cardPayments')}
            icon="card"
            variant="secondary"
            onPress={() => router.push('/topup')}
          />
        ) : null}
        <Button
          title={t('money.rides.history')}
          icon="time"
          variant="secondary"
          onPress={() => router.push('/rides')}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '800', color: colors.muted, textTransform: 'uppercase' },
  balance: { fontSize: 48, fontWeight: '900', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 22, fontWeight: '800' },
  pair: { flexDirection: 'row', gap: space.sm },
  divider: { height: 1, backgroundColor: colors.border },
});
