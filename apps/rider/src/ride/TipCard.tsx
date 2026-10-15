import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeError } from '../api/client';
import { type RideTipState, tipEndpoints, tipKeys, useRideTip } from '../api/tip-api';
import { formatMoney } from '../lib/format';
import { parseTipAmount, tipAmountError, tipEditable, tipStatusText } from '../lib/tips';
import { Banner, Button, Card, Chip, Segmented, T, TextField } from '../ui/primitives';
import { colors, space } from '../ui/theme';
import { CheckoutPanel } from './PaymentPanel';

/**
 * "Choychaqa" on the rating screen: 2 000 / 5 000 / 10 000 or another amount, in cash (the
 * rider hands it over; it is only recorded) or by card through Payme/Click (all of it goes to
 * the driver's balance). One tip per ride.
 */
export function TipCard({ rideId, driverName }: { rideId: string; driverName: string | null }) {
  const queryClient = useQueryClient();
  const state = useRideTip(rideId, true);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = state.data;
  if (!data || !data.rules.enabled) return null;
  const { tip, rules } = data;
  const editable = tipEditable(tip, rules);
  const chosen = custom ? parseTipAmount(custom) : amount;
  const amountError = chosen === null && !custom ? null : tipAmountError(chosen, rules);

  const give = async () => {
    if (chosen === null || amountError || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await tipEndpoints.give(rideId, { amount: chosen, method });
      queryClient.setQueryData<RideTipState>(tipKeys.tip(rideId), (old) =>
        old ? { ...old, tip: saved } : old,
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (tip && !editable) {
    return (
      <Banner
        tone={tip.status === 'failed' || tip.status === 'refunded' ? 'info' : 'success'}
        icon="heart-outline"
        message={tipStatusText(tip)}
      />
    );
  }
  if (!rules.open && !tip) return null;

  return (
    <Card style={styles.root}>
      <T variant="h3" accessibilityRole="header">
        Choychaqa{driverName ? ` — ${driverName}ga` : ''}
      </T>
      {tip?.status === 'awaiting_payment' && tip.payment ? (
        <CheckoutPanel
          payment={tip.payment}
          amount={tip.amount}
          label="Choychaqa"
          info="Choychaqa to‘liq haydovchiga yetadi: komissiya olinmaydi."
          expiredText="To‘lov tekshirilmoqda. To‘lamagan bo‘lsangiz, kartadan pul yechilmaydi."
          waitingText="To‘lov hali kelmadi. To‘lov sahifasida yakunlang."
          onCheck={() => state.refetch()}
        />
      ) : null}
      {tip?.status === 'failed' ? <Banner tone="info" message={tipStatusText(tip)} /> : null}
      <View style={styles.presets}>
        {rules.presets.map((p) => (
          <Chip
            key={p}
            label={formatMoney(p)}
            selected={!custom && amount === p}
            onPress={() => {
              setCustom('');
              setAmount(p);
            }}
          />
        ))}
      </View>
      <TextField
        placeholder={`Boshqa summa (${formatMoney(rules.min)} – ${formatMoney(rules.max)})`}
        accessibilityLabel="Boshqa summa"
        keyboardType="number-pad"
        value={custom}
        onChangeText={(t) => {
          setCustom(t);
          setAmount(null);
        }}
        error={custom ? amountError : null}
        maxLength={9}
      />
      {rules.card ? (
        <Segmented
          value={method}
          onChange={setMethod}
          options={[
            { value: 'cash', label: 'Naqd', icon: 'cash-outline' },
            { value: 'card', label: 'Karta', icon: 'card-outline' },
          ]}
        />
      ) : null}
      <T variant="small" color={colors.textMuted}>
        {method === 'cash'
          ? 'Naqd choychaqani haydovchiga o‘zingiz berasiz — biz faqat qayd etamiz.'
          : 'Kartadan to‘langan choychaqa to‘liq haydovchining balansiga tushadi.'}
      </T>
      {error ? <Banner tone="danger" message={error} /> : null}
      <Button
        title={
          chosen && !amountError ? `${formatMoney(chosen)} choychaqa berish` : 'Choychaqa berish'
        }
        icon="heart-outline"
        variant="secondary"
        loading={busy}
        disabled={chosen === null || Boolean(amountError)}
        onPress={() => void give()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { gap: space(3) },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
});
