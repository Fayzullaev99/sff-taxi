import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import { keys, useBooking } from '../../../api/queries';
import { useLiveRides } from '../../../api/realtime';
import { confirm } from '../../../lib/dialogs';
import { formatDateTime, formatMoney, formatPhone } from '../../../lib/format';
import {
  BOOKING_STATUS_LABELS,
  bookingCancelledText,
  bookingCancelTerms,
  CANCEL_RULE_TEXT,
  TRIP_STATUS_LABELS,
} from '../../../lib/intercity';
import { useNow } from '../../../lib/hooks';
import { callPhone } from '../../../lib/links';
import { Banner, Button, Card, IconButton, KeyValue, T } from '../../../ui/primitives';
import { ErrorView, LoadingView } from '../../../ui/states';
import { colors, radius, space } from '../../../ui/theme';

/**
 * A booking: the departure, the meeting point, and once booked the driver's name, phone
 * and plate; cancelling says its price first (free until 60 minutes before departure).
 */
export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useLiveRides();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useBooking(id);
  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = query.data;

  if (!b) {
    return query.isError ? (
      <ErrorView error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <LoadingView />
    );
  }

  const t = b.trip;
  const terms = bookingCancelTerms(t.departureAt, b.price, now);
  const ended = bookingCancelledText(b);

  const cancel = async () => {
    const ok = await confirm({
      title: 'Bronni bekor qilasizmi?',
      message: terms.message,
      confirmText: terms.fee > 0 ? `Bekor qilish (${formatMoney(terms.fee)})` : 'Bekor qilish',
      cancelText: 'Qoldirish',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await endpoints.cancelBooking(b.id, null);
      queryClient.setQueryData(keys.booking(b.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.bookings });
      void queryClient.invalidateQueries({ queryKey: keys.intercityTrip(t.id) });
      void queryClient.invalidateQueries({ queryKey: ['intercity-trips'] });
    } catch (e) {
      setError(describeError(e));
      void query.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(8) }]}
    >
      <View style={styles.head}>
        <T variant="h1" accessibilityRole="header">
          {t.from.nameUz} → {t.to.nameUz}
        </T>
        <T variant="h3">{formatDateTime(t.departureAt)}</T>
        <T variant="smallStrong" color={b.status === 'booked' ? colors.success : colors.textMuted}>
          Bron #{b.number} · {BOOKING_STATUS_LABELS[b.status]}
          {t.status !== 'scheduled' && t.status !== 'cancelled'
            ? ` · ${TRIP_STATUS_LABELS[t.status]}`
            : ''}
        </T>
      </View>

      {ended ? <Banner tone={b.status === 'no_show' ? 'warning' : 'info'} message={ended} /> : null}

      {b.contact ? (
        <Card style={styles.card}>
          <View style={styles.contact}>
            <View
              style={styles.plate}
              accessible
              accessibilityLabel={`Davlat raqami ${b.contact.plateFormatted.split('').join(' ')}`}
            >
              <T variant="plate" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {b.contact.plateFormatted}
              </T>
            </View>
            <View style={styles.flex}>
              <T variant="small" color={colors.textMuted} numberOfLines={2}>
                {t.vehicle.colour} {t.vehicle.make} {t.vehicle.model}
              </T>
            </View>
          </View>
          <View style={styles.contact}>
            <View style={styles.flex}>
              <T variant="bodyStrong">{b.contact.driverName}</T>
              <T variant="small" color={colors.textMuted}>
                {formatPhone(b.contact.driverPhone)}
              </T>
            </View>
            <IconButton
              name="call"
              label={`Haydovchiga qo‘ng‘iroq qilish: ${b.contact.driverName}`}
              size={52}
              color={colors.ink}
              background={colors.brand}
              onPress={() => void callPhone(b.contact!.driverPhone)}
            />
          </View>
        </Card>
      ) : null}

      <Card style={styles.card}>
        <KeyValue label="Uchrashuv joyi" value={t.meetingPoint} />
        <KeyValue label="Joylar" value={`${b.seats}${b.front ? ' (biri oldinda)' : ''}`} />
        <KeyValue label="Narx (naqd)" value={formatMoney(b.price)} strong />
        {b.pickupNote ? <KeyValue label="Izohingiz" value={b.pickupNote} /> : null}
        {b.cancellationFee > 0 ? (
          <KeyValue
            label="Bekor qilish to‘lovi"
            value={formatMoney(b.cancellationFee)}
            valueColor={colors.warning}
          />
        ) : null}
      </Card>

      {b.canCancel ? (
        <>
          <Banner
            tone={terms.fee > 0 ? 'warning' : 'info'}
            message={terms.fee > 0 ? terms.message : CANCEL_RULE_TEXT}
          />
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button
            title="Bronni bekor qilish"
            variant="danger"
            loading={busy}
            onPress={() => void cancel()}
          />
        </>
      ) : null}

      <Button
        title="Boshqa qatnovlar"
        variant="secondary"
        onPress={() => router.replace('/intercity')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3) },
  head: { gap: space(1) },
  card: { gap: space(2) },
  flex: { flex: 1, minWidth: 0 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  plate: {
    borderWidth: 2.5,
    borderColor: colors.ink,
    borderRadius: radius.sm,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
    backgroundColor: colors.bg,
    maxWidth: '60%',
  },
});
