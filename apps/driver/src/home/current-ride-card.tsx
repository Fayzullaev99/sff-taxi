import { useRouter } from 'expo-router';
import { memo } from 'react';
import type { DriverRide } from '../api/types';
import { useT } from '../i18n';
import { RIDE_STATUSES } from '../lib/format';
import { ridePool } from '../lib/pool';
import { nextStop, stopList, stopsFromPool } from '../lib/stops';
import { scheduledLabel } from '../lib/when';
import { Button, Card, Chip, Muted, Title } from '../ui/components';
import { colors } from '../ui/theme';

/**
 * The ride(s) in hand on the home tab: status, where to go next, back to the ride screen.
 * With several riders the API's stop list decides the next stop.
 */
export const CurrentRideCard = memo(function CurrentRideCard(props: { rides: DriverRide[] }) {
  const router = useRouter();
  const { t } = useT();
  if (!props.rides.length) return null;
  const first = props.rides[0]!;
  const pool = ridePool(first);
  const stops = pool ? stopsFromPool(pool.stops) : stopList(props.rides);
  const next = nextStop(stops);
  const numbers = pool
    ? [...new Set(pool.stops.map((s) => s.number).filter((n): n is number => !!n))]
    : props.rides.map((r) => r.number);
  const scheduled = scheduledLabel(first.scheduledFor, Date.now());
  return (
    <Card style={{ borderColor: colors.brand, borderWidth: 2 }}>
      <Chip
        label={
          pool
            ? t('home.currentRide.orders', {
                count: pool.riders ?? numbers.length,
                numbers: numbers.map((n) => `#${n}`).join(' '),
              })
            : numbers.map((n) => `#${n}`).join(' · ')
        }
        tone="brand"
      />
      <Title>{RIDE_STATUSES[first.status] ?? first.status}</Title>
      {scheduled ? <Chip label={scheduled} tone="info" icon="calendar" /> : null}
      {next ? (
        <Muted>
          {t(next.kind === 'pickup' ? 'home.currentRide.pickup' : 'home.currentRide.dropoff', {
            where: `${next.riderName ? `${next.riderName} · ` : ''}${
              next.place.address ?? next.place.landmark ?? t('home.currentRide.somePoint')
            }`,
          })}
        </Muted>
      ) : null}
      <Button
        title={t('home.currentRide.backToRide')}
        icon="navigate"
        big
        onPress={() => router.navigate('/ride')}
      />
    </Card>
  );
});
