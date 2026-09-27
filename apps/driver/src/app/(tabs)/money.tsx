import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { driver } from '../../api/driver';
import { keys, useBalance, useDriverConfig, useEarnings, useFeatures } from '../../data/queries';
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
      Alert.alert('Abonement olindi', `${passLabel(pass)}. Balans: ${som(pass.balance)}`);
      void qc.invalidateQueries({ queryKey: keys.balance });
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.passes });
    },
    onError: (error) => {
      haptics.error();
      Alert.alert('Abonement olinmadi', errorMessage(error));
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
      kind === 'day' ? 'Kunlik abonement' : 'Haftalik abonement',
      `${som(price)} balansdan yechiladi. Shahar ichidagi safarlar komissiyasiz bo‘ladi (${billing.taxPercent}% soliq qoladi).`,
      [
        { text: 'Bekor qilish', style: 'cancel' },
        { text: 'Sotib olish', onPress: () => buy.mutate(kind) },
      ],
    );
  };

  return (
    <Screen
      title="Daromad"
      refreshing={balance.isRefetching}
      onRefresh={() => {
        void balance.refetch();
        void earnings.refetch();
        void qc.invalidateQueries({ queryKey: keys.driverConfig });
      }}
    >
      <Card style={{ alignItems: 'center' }}>
        <Text style={styles.label}>Balans</Text>
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
          {digits(b.balance)} <Text style={styles.unit}>so‘m</Text>
        </Text>
        <Muted center>
          Minimal balans {som(b.minBalance)}: undan past bo‘lsa liniyaga chiqib bo‘lmaydi. Komissiya
          va soliq har safardan keyin shu balansdan yechiladi.
        </Muted>
        {byCard && status.canWork && status.level === 'ok' ? (
          <Button
            title="Karta bilan to‘ldirish"
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
        title={promo.active ? `0% komissiya — yana ${promo.daysLeft} kun` : 'Komissiya'}
        text={promo.text}
      />

      <Card>
        <Title>Qoidalar</Title>
        <Row
          label="Shahar ichida komissiya"
          value={promo.active ? '0% (aksiya)' : `${billing.commissionPercent}%`}
        />
        <Row label="Kunlik chegara" value={som(billing.dailyCap)} />
        <Row label="Haftalik chegara" value={som(billing.weeklyCap)} />
        <Row
          label="Shaharlararo"
          value={`${billing.intercityPercent}%, safarga ko‘pi bilan ${som(billing.intercityTripCap)}`}
        />
        <Row label="Aylanma soliq" value={`${billing.taxPercent}%`} />
        <Row label="Minimal balans" value={som(billing.minBalance)} />
      </Card>

      {passes ? (
        <Card>
          <Title>Abonement</Title>
          {b.activePass ? (
            <Banner tone="success" icon="checkmark-circle" text={passLabel(b.activePass)} />
          ) : (
            <Muted>
              Abonement bilan shahar ichidagi safarlar komissiyasiz. Kunlik {som(billing.passDay)} —
              kuniga {som(passBreakEven('day', billing))} dan ko‘p ishlasangiz foydali.
            </Muted>
          )}
          {advice ? <Muted>{advice}</Muted> : null}
          <View style={styles.pair}>
            <Button
              title={`Kunlik · ${som(billing.passDay)}`}
              variant="secondary"
              disabled={promo.active}
              loading={buy.isPending && buy.variables === 'day'}
              onPress={() => confirmBuy('day')}
              style={{ flex: 1 }}
            />
            <Button
              title={`Haftalik · ${som(billing.passWeek)}`}
              variant="secondary"
              disabled={promo.active}
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
            { value: 'day' as const, label: 'Bugun' },
            { value: 'week' as const, label: 'Shu hafta' },
          ]}
          selected={[period]}
          onToggle={setPeriod}
        />
        {e ? (
          <>
            <Row label="Safarlar" value={String(e.rides)} />
            {e.intercityBookings ? (
              <Row label="Shaharlararo yo‘lovchilar" value={String(e.intercityBookings)} />
            ) : null}
            <Row label="Yo‘lovchilar to‘lagan" value={som(e.fares)} />
            <Row label="Shundan naqd" value={som(e.cash)} />
            {e.fares > e.cash ? (
              <Row label="Kartada (balansingizga)" value={som(e.fares - e.cash)} />
            ) : null}
            <Row label="Platforma komissiyasi" value={som(-e.commission)} />
            <Row label={`Soliq ${billing.taxPercent}% (siz uchun to‘landi)`} value={som(-e.tax)} />
            <View style={styles.divider} />
            <Row label="Sof daromad" value={som(e.net)} strong tone="success" />
            <Muted>
              {billing.taxPercent}% aylanma soliqni SFF soliq agenti sifatida JShShIR bo‘yicha
              ushlab, davlatga to‘laydi (PQ-247). Sizdan boshqa soliq hisobotini talab qilmaydi.
            </Muted>
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
        <Title>So‘nggi amallar</Title>
        {b.entries.length === 0 ? <Muted>Hali amallar yo‘q</Muted> : null}
        {b.entries.slice(0, 8).map((x) => (
          <Row
            key={x.id}
            label={`${LEDGER_KINDS[x.kind] ?? x.kind} · ${dateTime(x.createdAt)}`}
            value={`${x.amount > 0 ? '+' : ''}${som(x.amount)}`}
            tone={x.amount > 0 ? 'success' : undefined}
          />
        ))}
        {hasCardMoney ? (
          <Muted>
            Karta bilan to‘langan safarlar puli balansingizga yoziladi; operator uni kartangizga
            o‘tkazganda “Kartangizga o‘tkazildi” bo‘lib ko‘rinadi.
          </Muted>
        ) : null}
        <Button
          title="Barcha amallar"
          icon="list"
          variant="secondary"
          onPress={() => router.push('/ledger')}
        />
        {byCard ? (
          <Button
            title="Karta to‘lovlari"
            icon="card"
            variant="secondary"
            onPress={() => router.push('/topup')}
          />
        ) : null}
        <Button
          title="Safarlar tarixi"
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
