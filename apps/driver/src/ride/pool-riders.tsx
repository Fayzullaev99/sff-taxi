import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { DriverRide } from '../api/types';
import { RIDE_STATUSES, som } from '../lib/format';
import { seatsText, type Seats } from '../lib/pool';
import { cashBreakdown } from '../lib/ride-flow';
import { call } from '../ui/actions';
import { Button, Card, Chip, Muted, Title } from '../ui/components';
import { colors, space } from '../ui/theme';

/**
 * Everyone sharing the car: name, how many people, where each is in the trip, the cash to
 * take from each (their own `collectCash`: shared discount and deposit already off) and a
 * call button per rider.
 */
export const PoolRidersCard = memo(function PoolRidersCard(props: {
  rides: DriverRide[];
  focusId: string;
  seats: (Partial<Seats> & { inCar?: number }) | null;
}) {
  return (
    <Card>
      <Title>Mashinadagi yo‘lovchilar</Title>
      {props.seats && typeof props.seats.capacity === 'number' ? (
        <Muted>
          {typeof props.seats.inCar === 'number'
            ? `Hozir mashinada ${props.seats.inCar} kishi · `
            : ''}
          {seatsText({
            occupied: props.seats.occupied ?? 0,
            capacity: props.seats.capacity,
            front: props.seats.front ?? 0,
            rear: props.seats.rear ?? 0,
            free: props.seats.free ?? 0,
          })}
        </Muted>
      ) : null}
      {props.rides.map((r) => {
        const cash = cashBreakdown(r);
        const n = r.passengers ?? 1;
        const focus = r.id.toLowerCase() === props.focusId.toLowerCase();
        return (
          <View key={r.id} style={[styles.rider, focus && styles.focus]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name} numberOfLines={1}>
                {r.rider?.name ?? 'Yo‘lovchi'} · #{r.number}
              </Text>
              <View style={styles.chips}>
                <Chip
                  label={RIDE_STATUSES[r.status] ?? r.status}
                  tone={focus ? 'brand' : 'neutral'}
                />
                {n > 1 ? <Chip label={`${n} kishi`} tone="info" /> : null}
              </View>
              <Text style={styles.cash}>
                {r.paymentMethod === 'card'
                  ? cash.total > 0
                    ? `Kutish uchun naqd: ${som(cash.total)}`
                    : 'Kartada to‘langan — naqd olmang'
                  : `Naqd oling: ${som(cash.total)}`}
              </Text>
              {r.fare.deposit ? <Muted>{som(r.fare.deposit)} oldindan to‘langan</Muted> : null}
            </View>
            {r.rider?.phone ? (
              <Button
                title="Qo‘ng‘iroq"
                icon="call"
                variant="secondary"
                onPress={() => call(r.rider?.phone)}
              />
            ) : null}
          </View>
        );
      })}
    </Card>
  );
});

const styles = StyleSheet.create({
  rider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexWrap: 'wrap',
  },
  focus: { borderLeftWidth: 4, borderLeftColor: colors.brand, paddingLeft: space.sm },
  name: { fontSize: 18, fontWeight: '800', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  cash: { fontSize: 17, fontWeight: '800', color: colors.brand },
});
