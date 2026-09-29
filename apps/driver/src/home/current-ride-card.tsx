import { useRouter } from 'expo-router';
import { memo } from 'react';
import type { DriverRide } from '../api/types';
import { RIDE_STATUSES } from '../lib/format';
import { nextStop, stopList } from '../lib/stops';
import { scheduledLabel } from '../lib/when';
import { Button, Card, Chip, Muted, Title } from '../ui/components';
import { colors } from '../ui/theme';

/**
 * The ride(s) in hand on the home tab: status, where to go next, back to the ride screen.
 * Built on the stop list, so several riders at once (shared rides) fit without changes.
 */
export const CurrentRideCard = memo(function CurrentRideCard(props: { rides: DriverRide[] }) {
  const router = useRouter();
  if (!props.rides.length) return null;
  const stops = stopList(props.rides);
  const next = nextStop(stops);
  const first = props.rides[0]!;
  const scheduled = scheduledLabel(first.scheduledFor, Date.now());
  return (
    <Card style={{ borderColor: colors.brand, borderWidth: 2 }}>
      <Chip label={props.rides.map((r) => `#${r.number}`).join(' · ')} tone="brand" />
      <Title>{RIDE_STATUSES[first.status] ?? first.status}</Title>
      {scheduled ? <Chip label={scheduled} tone="info" icon="calendar" /> : null}
      {next ? (
        <Muted>
          {next.kind === 'pickup' ? 'Yo‘lovchi: ' : 'Manzil: '}
          {next.place.address ?? next.place.landmark ?? 'Belgilangan nuqta'}
        </Muted>
      ) : null}
      <Button
        title="Safarga qaytish"
        icon="navigate"
        big
        onPress={() => router.navigate('/ride')}
      />
    </Card>
  );
});
